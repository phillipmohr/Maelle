/** POST /api/tickets/:id/reject — owner: IRDR-457. Stub. */
import type { RejectRequest } from '#shared/api'
import { REJECT_REASONS } from '#shared/services'
import { stubHeaders } from '../../../utils/stubs'

export default defineEventHandler(async (event) => {
  stubHeaders(event, 'IRDR-457')
  const body = await readBody<RejectRequest>(event)
  if (!body || !(REJECT_REASONS as readonly string[]).includes(body.reason)) {
    throw createError({
      statusCode: 400,
      statusMessage: `reason must be one of ${REJECT_REASONS.join(', ')}`,
    })
  }
  return { decisionId: `stub-decision-${getRouterParam(event, 'id')}`, ticketStatus: 'manual' }
})
