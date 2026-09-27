/** POST /api/tickets/:id/case — owner: IRDR-457 (enqueues a case_override run, IRDR-456). Stub. */
import type { SetCaseRequest } from '#shared/api'
import { isCaseType } from '#shared/case-types'
import { services } from '../../../utils/services'
import { stubHeaders } from '../../../utils/stubs'

export default defineEventHandler(async (event) => {
  stubHeaders(event, 'IRDR-457')
  const id = decodeURIComponent(getRouterParam(event, 'id') ?? '')
  const body = await readBody<SetCaseRequest>(event)
  if (!body || !isCaseType(body.caseType))
    throw createError({ statusCode: 400, statusMessage: 'caseType must be a known case type' })
  const job = await services.jobs.enqueue('agent_run', { ticketId: id, trigger: 'case_override' })
  return { ok: true as const, caseType: body.caseType, jobId: job.id }
})
