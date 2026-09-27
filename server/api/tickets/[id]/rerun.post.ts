/** POST /api/tickets/:id/rerun — owner: IRDR-456. Enqueues an agent run through the jobs service. */
import type { RerunRequest } from '#shared/api'
import { services } from '../../../utils/services'
import { stubHeaders } from '../../../utils/stubs'

export default defineEventHandler(async (event) => {
  stubHeaders(event, 'IRDR-456')
  const id = decodeURIComponent(getRouterParam(event, 'id') ?? '')
  const body =
    (await readBody<RerunRequest | null>(event).catch(() => null)) ?? ({} as RerunRequest)
  const trigger = body.trigger ?? 'rerun'
  const job = await services.jobs.enqueue('agent_run', { ticketId: id, trigger })
  return { runId: job.id, trigger }
})
