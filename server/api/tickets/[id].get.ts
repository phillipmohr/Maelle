/**
 * GET /api/tickets/:id — owner: IRDR-458 (UI). Foundation stub answers from the seed data.
 * `:id` is the ticket uuid or the display number ("4825" or "#4825").
 */
import type { TicketDetailResponse } from '#shared/api'
import { seedTicketDetail } from '#shared/seed/views'
import { seedBundle, stubHeaders } from '../../utils/stubs'

export default defineEventHandler((event): TicketDetailResponse => {
  stubHeaders(event, 'IRDR-458')
  const id = decodeURIComponent(getRouterParam(event, 'id') ?? '')
  const detail = seedTicketDetail(seedBundle(), id)
  if (!detail) throw createError({ statusCode: 404, statusMessage: 'Ticket not found' })
  return detail
})
