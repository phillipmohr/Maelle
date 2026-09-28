/**
 * POST /api/tickets/:id/case — owner: IRDR-457. Stores the case override on the ticket and enqueues a
 * `case_override` agent run (IRDR-456 owns the run itself).
 */
import { handled, readValidatedBody, ticketParam, useExecutor } from '../../../executor/http'
import { SetCaseBodySchema } from '../../../executor/schemas'

export default defineEventHandler(async (event) => {
  const id = ticketParam(event)
  const executor = useExecutor()
  const body = await readValidatedBody(event, SetCaseBodySchema)
  const r = await handled(event, () => executor.setCaseAndEnqueue(id, body.caseType))
  return { ok: true as const, caseType: r.caseType, ticketStatus: r.ticketStatus, jobId: r.jobId }
})
