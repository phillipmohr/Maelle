/**
 * Linear webhook (IRDR-455): when an issue of the InstaRadar team reaches a completed state, every
 * stored customer email for that issue gets one release_notification ticket (skipping the ones
 * already notified) and an agent run, so the notification goes through the normal approval flow.
 * The signature is HMAC-SHA256 (hex) of the raw body with LINEAR_WEBHOOK_SECRET in
 * `Linear-Signature`; `webhookTimestamp` guards against replays.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { LinearWebhookAck } from '#shared/api'
import type { Db } from '../jobs/db'
import { JobQueue } from '../jobs/queue'

export const LINEAR_SIGNATURE_HEADER = 'linear-signature'
export const LINEAR_TIMESTAMP_TOLERANCE_MS = 5 * 60_000

export function signLinearBody(rawBody: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex')
}

export function verifyLinearSignature(
  rawBody: string | Buffer,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!secret || !signature) return false
  const given = signature.trim()
  if (!/^[0-9a-f]{64}$/i.test(given)) return false
  const expected = Buffer.from(signLinearBody(rawBody, secret), 'hex')
  const provided = Buffer.from(given, 'hex')
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

export function isFreshTimestamp(
  ts: unknown,
  now: Date,
  toleranceMs: number = LINEAR_TIMESTAMP_TOLERANCE_MS,
): boolean {
  const n = Number(ts)
  if (!Number.isFinite(n)) return false
  return Math.abs(now.getTime() - n) <= toleranceMs
}

export interface LinearIssuePayload {
  action?: string
  type?: string
  data?: {
    id?: string
    identifier?: string
    title?: string
    teamId?: string
    team?: { id?: string; key?: string; name?: string }
    state?: { id?: string; type?: string; name?: string }
    stateId?: string
    completedAt?: string | null
    url?: string
  }
  updatedFrom?: Record<string, unknown>
  url?: string
  webhookTimestamp?: number
  webhookId?: string
  organizationId?: string
}

/** An Issue that just moved into a state of type `completed` (or was created completed). */
export function isIssueCompletion(p: LinearIssuePayload): boolean {
  if (p.type !== 'Issue' || p.data?.state?.type !== 'completed') return false
  if (p.action === 'create') return true
  if (p.action !== 'update') return false
  const from = p.updatedFrom ?? {}
  return 'stateId' in from || 'completedAt' in from || 'state' in from
}

export function matchesTeam(
  p: LinearIssuePayload,
  opts: { teamId?: string | null; teamKey?: string | null },
): boolean {
  if (!opts.teamId && !opts.teamKey) return true
  const ids = [p.data?.teamId, p.data?.team?.id].filter(Boolean)
  if (opts.teamId && ids.includes(opts.teamId)) return true
  if (opts.teamKey) {
    const key = opts.teamKey.toUpperCase()
    if (p.data?.team?.key?.toUpperCase() === key) return true
    if (!p.data?.team?.key && p.data?.identifier?.toUpperCase().startsWith(`${key}-`)) return true
  }
  return false
}

export class WebhookError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'WebhookError'
  }
}

export interface LinearWebhookInput {
  rawBody: string
  signature: string | null | undefined
  secret: string | null | undefined
  db: Db
  now?: Date
  teamId?: string | null
  teamKey?: string | null
  skipTimestampCheck?: boolean
}

export type LinearWebhookResult = LinearWebhookAck & { matched: boolean }

export async function processLinearWebhook(
  input: LinearWebhookInput,
): Promise<LinearWebhookResult> {
  if (!input.secret) throw new WebhookError(503, 'LINEAR_WEBHOOK_SECRET is not configured')
  if (!verifyLinearSignature(input.rawBody, input.signature, input.secret)) {
    throw new WebhookError(401, 'Invalid Linear-Signature')
  }
  let payload: LinearIssuePayload
  try {
    payload = JSON.parse(input.rawBody) as LinearIssuePayload
  } catch {
    throw new WebhookError(400, 'Body is not JSON')
  }
  const now = input.now ?? new Date()
  if (
    !input.skipTimestampCheck &&
    payload.webhookTimestamp != null &&
    !isFreshTimestamp(payload.webhookTimestamp, now)
  ) {
    throw new WebhookError(401, 'Stale webhookTimestamp')
  }
  if (!isIssueCompletion(payload) || !matchesTeam(payload, input)) {
    return { ok: true, created: 0, skipped: 0, matched: false }
  }
  const ack = await createReleaseNotificationTickets(input.db, payload, now)
  return { ...ack, matched: true }
}

interface ReleaseRow {
  id: string
  app_id: string
  email: string
  notified_at: Date | null
  ticket_id: string | null
}

export async function createReleaseNotificationTickets(
  db: Db,
  payload: LinearIssuePayload,
  now: Date = new Date(),
): Promise<LinearWebhookAck> {
  const identifier = payload.data?.identifier ?? null
  const issueId = payload.data?.id ?? null
  if (!identifier && !issueId) return { ok: true, created: 0, skipped: 0 }
  // No em dash in anything that may reach the customer; the issue title is Phillip's, not ours.
  const title = (payload.data?.title ?? identifier ?? 'an update').replace(/[—―]/g, '-').trim()
  return db.transaction(async (tx) => {
    const rows = await tx.query<ReleaseRow>(
      `select id, app_id, email, notified_at, ticket_id from public.release_notifications
       where ($1::text is not null and linear_issue_identifier = $1)
          or ($2::text is not null and linear_issue_id = $2)
       order by created_at asc
       for update`,
      [identifier, issueId],
    )
    const queue = new JobQueue(tx)
    const seen = new Set<string>()
    let created = 0
    let skipped = 0
    for (const rn of rows) {
      const email = rn.email.trim().toLowerCase()
      if (rn.notified_at || seen.has(email)) {
        skipped++
        continue
      }
      seen.add(email)
      const original = rn.ticket_id
        ? await tx.one<{ customer_name: string | null }>(
            'select customer_name from public.tickets where id = $1',
            [rn.ticket_id],
          )
        : null
      const tags = ['release_notification', identifier ?? issueId!]
      const ticket = await tx.one<{ id: string }>(
        `insert into public.tickets (app_id, customer_email, customer_name, subject, status, case_type, case_confidence,
           tags, first_message_at, last_message_at)
         values ($1, $2, $3, $4, 'new', 'release_notification', 1, $5, $6, $6)
         returning id`,
        [rn.app_id, email, original?.customer_name ?? null, `Release: ${title}`, tags, now],
      )
      await tx.query(
        `update public.release_notifications
         set notified_at = $2, notification_ticket_id = $3, linear_issue_id = coalesce(linear_issue_id, $4)
         where id = $1`,
        [rn.id, now, ticket!.id, issueId],
      )
      await queue.enqueue(
        'agent_run',
        { ticketId: ticket!.id, trigger: 'release_notification' },
        { dedupeKey: `agent_run:${ticket!.id}:release_notification`, runAt: now },
      )
      created++
    }
    return { ok: true, created, skipped }
  })
}
