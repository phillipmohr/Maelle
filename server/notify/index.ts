/**
 * notify(kind, payload): email to NOTIFY_EMAIL (or settings.notify_email) through
 * services.mail.sendSystemEmail, logged and deduped in the notifications table.
 *
 *   high_risk_ticket  once per ticket, sent by autonomy.evaluate as soon as the ticket needs a decision
 *   daily_digest      once per local day, registered as the `daily_digest` job handler
 *   system_alert      every time (mail fetch failing, dead-letter jobs), sent by the job runner
 */
import type { NotifyFn, NotifyKind, NotifyPayloads } from '#shared/services'
import type { DigestData } from './digest'
import { localDateKey } from './digest'
import type { NotificationLog } from './log'
import {
  renderDigest,
  renderHighRiskAlert,
  renderSystemAlert,
  type RenderedMail,
} from './templates'

export interface NotifyDeps {
  sendSystemEmail: (to: string, subject: string, body: string) => Promise<void>
  /** settings.notify_email, then NOTIFY_EMAIL; null when neither is set. */
  recipient: () => Promise<string | null>
  log: NotificationLog
  /** Builds the digest data since the last digest. */
  digest: () => Promise<DigestData>
  now?: () => Date
  logger?: (msg: string) => void
}

export function createNotify(deps: NotifyDeps): NotifyFn {
  const logger = deps.logger ?? ((msg) => console.info(msg))
  const now = deps.now ?? (() => new Date())

  async function render<K extends NotifyKind>(
    kind: K,
    payload: NotifyPayloads[K],
  ): Promise<{
    mail: RenderedMail
    dedupeKey: string | null
    ticketId: string | null
    meta: Record<string, unknown>
  }> {
    if (kind === 'high_risk_ticket') {
      const p = payload as NotifyPayloads['high_risk_ticket']
      return {
        mail: renderHighRiskAlert(p),
        dedupeKey: p.ticketId,
        ticketId: p.ticketId,
        meta: { riskLevel: p.riskLevel, caseType: p.caseType },
      }
    }
    if (kind === 'daily_digest') {
      const data = await deps.digest()
      return {
        mail: renderDigest(data),
        dedupeKey: `digest:${localDateKey(now(), data.timezone)}`,
        ticketId: null,
        meta: {
          since: data.since,
          until: data.until,
          counts: {
            autoHandled: data.autoHandled.length,
            needsDecision: data.needsDecision.length,
            waiting: data.waiting.length,
            failures: data.failures.length,
          },
        },
      }
    }
    const p = payload as NotifyPayloads['system_alert']
    return {
      mail: renderSystemAlert(p, now()),
      dedupeKey: null,
      ticketId: null,
      meta: { source: p.source },
    }
  }

  return async (kind, payload) => {
    const { mail, dedupeKey, ticketId, meta } = await render(kind, payload)
    const claim = await deps.log.claim({ kind, dedupeKey, ticketId, meta })
    if (!claim) {
      logger(`[notify] ${kind} skipped, already sent (${dedupeKey})`)
      return
    }
    const to = await deps.recipient()
    if (!to) {
      await deps.log.finish(claim.id, {
        status: 'skipped',
        recipient: null,
        ...mail,
        error: 'No recipient: set NOTIFY_EMAIL or the notify email on the Autonomy page',
      })
      logger(`[notify] ${kind} skipped, no recipient configured`)
      return
    }
    try {
      await deps.sendSystemEmail(to, mail.subject, mail.body)
      await deps.log.finish(claim.id, { status: 'sent', recipient: to, ...mail })
      logger(`[notify] ${kind} sent to ${to}: ${mail.subject}`)
    } catch (e) {
      const message = (e as Error).message
      await deps.log.finish(claim.id, { status: 'failed', recipient: to, ...mail, error: message })
      logger(`[notify] ${kind} failed: ${message}`)
      throw e
    }
  }
}
