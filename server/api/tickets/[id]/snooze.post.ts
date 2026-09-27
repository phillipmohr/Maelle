/** POST /api/tickets/:id/snooze — owner: IRDR-457. Stub: refuses safety tickets like the real one. */
import type { SnoozeRequest } from '#shared/api'
import { seedTicketDetail } from '#shared/seed/views'
import { seedBundle, stubHeaders } from '../../../utils/stubs'

export default defineEventHandler(async (event) => {
  stubHeaders(event, 'IRDR-457')
  const id = decodeURIComponent(getRouterParam(event, 'id') ?? '')
  const detail = seedTicketDetail(seedBundle(), id)
  if (!detail) throw createError({ statusCode: 404, statusMessage: 'Ticket not found' })
  if (detail.ticket.riskLevel === 'safety')
    throw createError({ statusCode: 422, statusMessage: 'Safety tickets cannot be snoozed' })
  const body = await readBody<SnoozeRequest>(event)
  if (!body?.until || Number.isNaN(Date.parse(body.until)))
    throw createError({ statusCode: 400, statusMessage: 'until must be an ISO timestamp' })
  return {
    ok: true as const,
    ticketStatus: 'snoozed',
    snoozedUntil: new Date(body.until).toISOString(),
  }
})
