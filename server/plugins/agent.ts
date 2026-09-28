/**
 * Registers the agent service (IRDR-456) and the `agent_run` job handler.
 *
 * Nitro runs plugins in file order. The handler is registered on the current jobs service right
 * away and once more after every plugin ran, so it lands on the real jobs service when the mail/jobs
 * plugin (IRDR-455) replaces the stub after this file. Registration is idempotent (a map set).
 */
import { createAgentService } from '../agent'
import { registerService, services } from '../utils/services'

export default defineNitroPlugin(() => {
  const agent = createAgentService()
  registerService('agent', agent)
  const register = () =>
    services.jobs.registerHandler('agent_run', async (payload, ctx) => {
      const r = await agent.run(payload.ticketId, payload.trigger, {
        jobId: ctx.jobId,
        attempt: ctx.attempt,
      })
      // A retryable failure (model overloaded, a source timed out) must reach the job runner, which
      // backs off and tries again; precondition failures (wrong status, missing ticket) end here.
      if (r.status === 'failed' && r.retryable) throw new Error(r.error ?? 'agent run failed')
    })
  register()
  setTimeout(register, 0)
})
