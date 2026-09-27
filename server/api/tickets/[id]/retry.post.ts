/** POST /api/tickets/:id/retry — owner: IRDR-457. Stub: failed → succeeded, held → succeeded. */
import type { ApproveResponse } from '#shared/api'
import { seedTicketDetail } from '#shared/seed/views'
import { seedBundle, stubHeaders } from '../../../utils/stubs'

export default defineEventHandler((event): ApproveResponse => {
  stubHeaders(event, 'IRDR-457')
  const id = decodeURIComponent(getRouterParam(event, 'id') ?? '')
  const detail = seedTicketDetail(seedBundle(), id)
  if (!detail) throw createError({ statusCode: 404, statusMessage: 'Ticket not found' })
  return {
    decisionId: `stub-retry-${detail.ticket.displayNumber}`,
    ticketStatus: 'closed',
    executions: detail.executions
      .filter((e) => e.status === 'failed' || e.status === 'held')
      .map((e) => ({
        executionId: e.id,
        type: e.type,
        status: 'succeeded' as const,
        result: { stub: true, retried: true },
      })),
  }
})
