/**
 * POST /api/tickets/:id/rerun — owner: IRDR-456. Enqueues an agent run (trigger `rerun`, or
 * `case_override` after the user picked a case) through the jobs service. While the jobs service is
 * still the foundation stub (nothing executes queued jobs), the run is started inline in the
 * background so the dev server stays useful. `:id` is the ticket uuid or the display number.
 */
import type { RerunRequest } from '#shared/api'
import { isServiceRegistered, services } from '../../../utils/services'
import { resolveTicketId } from '../../../utils/tickets'

export default defineEventHandler(async (event) => {
  const id = await resolveTicketId(getRouterParam(event, 'id') ?? '')
  const body =
    (await readBody<RerunRequest | null>(event).catch(() => null)) ?? ({} as RerunRequest)
  const trigger = body.trigger ?? 'rerun'
  if (trigger !== 'rerun' && trigger !== 'case_override')
    throw createError({ statusCode: 400, statusMessage: 'trigger must be rerun or case_override' })
  const job = await services.jobs.enqueue('agent_run', { ticketId: id, trigger })
  const inline = !isServiceRegistered('jobs')
  if (inline) {
    void services.agent
      .run(id, trigger)
      .catch((e: unknown) => console.error('[agent] inline rerun failed', e))
  }
  return { runId: job.id, jobId: job.id, trigger, inline }
})
