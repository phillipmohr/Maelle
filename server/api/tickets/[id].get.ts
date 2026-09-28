/**
 * GET /api/tickets/:id — owner: IRDR-458 (UI). `:id` is the ticket uuid or the display number
 * ("4825" or "#4825"). Reads the database when it is configured, otherwise the seed views.
 */
import type { TicketDetailResponse } from '#shared/api'
import { seedTicketDetail } from '#shared/seed/views'
import { ticketDetailFromDb } from '#shared/ticket-repository'
import { dbQuery, isDbConfigured } from '../../utils/db'
import { seedBundle, stubHeaders } from '../../utils/stubs'

export default defineEventHandler(async (event): Promise<TicketDetailResponse> => {
  const id = decodeURIComponent(getRouterParam(event, 'id') ?? '')
  const detail = isDbConfigured()
    ? await ticketDetailFromDb((text, params) => dbQuery(text, params ?? []), id)
    : (stubHeaders(event, 'IRDR-458'), seedTicketDetail(seedBundle(), id))
  if (!detail) throw createError({ statusCode: 404, statusMessage: 'Ticket not found' })
  return detail
})
