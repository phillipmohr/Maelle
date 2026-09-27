/**
 * Registers the real mail service as `services.mail` (IRDR-455) plus the fetch_mail and
 * send_system_email job handlers. A misconfigured provider is logged and leaves the stub in place,
 * so the app still boots; the health check alerts when fetch_mail stops succeeding.
 */
import { getMailContext } from '../mail/context'
import { createMailService, registerMailJobHandlers } from '../mail/service'
import { registerService, services } from '../utils/services'

export default defineNitroPlugin(() => {
  try {
    const ctx = getMailContext()
    registerService('mail', createMailService(ctx))
    registerMailJobHandlers(services.jobs, ctx)
    console.info(
      `[mail] provider=${ctx.provider.kind} mailbox=${ctx.config.mailbox} storage=${ctx.store.kind}`,
    )
  } catch (e) {
    console.error(`[mail] service not registered: ${(e as Error).message}`)
  }
})
