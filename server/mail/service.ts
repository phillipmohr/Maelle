/** The `services.mail` implementation and the mail job handlers (IRDR-455). */
import type { JobsService, MailService } from '#shared/services'
import { getMailContext, type MailContext } from './context'
import { fetchMail } from './inbound'
import { sendReply, sendSystemEmail } from './outbound'

export function createMailService(ctx?: MailContext): MailService {
  const context = () => ctx ?? getMailContext()
  return {
    sendReply: (ticketId, draft, opts) => sendReply(context(), ticketId, draft, opts),
    sendSystemEmail: (to, subject, body) => sendSystemEmail(context(), to, subject, body),
  }
}

/** fetch_mail and send_system_email are handled here; the other job types belong to other tickets. */
export function registerMailJobHandlers(jobs: JobsService, ctx?: MailContext): void {
  const context = () => ctx ?? getMailContext()
  jobs.registerHandler('fetch_mail', async () => {
    await fetchMail(context())
  })
  jobs.registerHandler('send_system_email', async (payload) => {
    await sendSystemEmail(context(), payload.to, payload.subject, payload.body)
  })
}
