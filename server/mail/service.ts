/** The `services.mail` implementation and the mail job handlers (IRDR-455). */
import type { JobsService, MailService } from '#shared/services'
import { JobQueue } from '../jobs/queue'
import { runBackfillChunk } from './backfill'
import { getMailContext, type MailContext } from './context'
import { runClassifyChunk, scheduleImportedClassification } from './history-classify'
import { fetchMail } from './inbound'
import { sendReply, sendSystemEmail } from './outbound'

export function createMailService(ctx?: MailContext): MailService {
  const context = () => ctx ?? getMailContext()
  return {
    sendReply: (ticketId, draft, opts) => sendReply(context(), ticketId, draft, opts),
    sendSystemEmail: (to, subject, body) => sendSystemEmail(context(), to, subject, body),
  }
}

/**
 * fetch_mail, send_system_email and the two history-import chunk jobs are handled here; the other
 * job types belong to other tickets. A chunk job re-enqueues itself while work remains.
 */
export function registerMailJobHandlers(jobs: JobsService, ctx?: MailContext): void {
  const context = () => ctx ?? getMailContext()
  jobs.registerHandler('fetch_mail', async () => {
    await fetchMail(context())
  })
  jobs.registerHandler('send_system_email', async (payload) => {
    await sendSystemEmail(context(), payload.to, payload.subject, payload.body)
  })
  jobs.registerHandler('backfill_mail', async () => {
    const c = context()
    const r = await runBackfillChunk(c)
    c.log(
      `[mail] history import chunk (${r.folder ?? 'nothing left'}): listed ${r.listed}, imported ${r.imported}, skipped ${r.skipped}, ignored ${r.ignored}, failed ${r.failed}`,
    )
    if (r.finishedNow) {
      const s = await scheduleImportedClassification(c)
      c.log(
        `[mail] history import done; classification ${s.started ? 'scheduled' : `not scheduled: ${s.reason}`}`,
      )
    }
    if (!r.done) await new JobQueue(c.db).enqueue('backfill_mail', {}, { runAt: c.now() })
  })
  jobs.registerHandler('classify_imported', async () => {
    const c = context()
    const r = await runClassifyChunk(c)
    c.log(
      `[mail] classify chunk: ${r.classified} classified, ${r.failed} failed, ${r.remaining} waiting`,
    )
    if (!r.done) await new JobQueue(c.db).enqueue('classify_imported', {}, { runAt: c.now() })
  })
}
