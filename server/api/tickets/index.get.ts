/**
 * GET /api/tickets — owner: IRDR-458 (UI). Foundation stub answers from the seed data.
 * Query: status (comma separated), q, caseType, resolution, from, to, cursor, limit.
 */
import type { TicketListQuery, TicketListResponse } from '#shared/api'
import { seedTicketList } from '#shared/seed/views'
import { seedBundle, stubHeaders } from '../../utils/stubs'

export default defineEventHandler((event): TicketListResponse => {
  stubHeaders(event, 'IRDR-458')
  const q = getQuery(event) as TicketListQuery
  const list = seedTicketList(seedBundle())
  let items = list.items
  if (q.status) {
    const statuses = String(q.status).split(',')
    items = items.filter((i) => statuses.includes(i.status))
  }
  if (q.caseType) items = items.filter((i) => i.caseType === q.caseType)
  if (q.resolution) items = items.filter((i) => i.resolution === q.resolution)
  if (q.q) {
    const needle = String(q.q).toLowerCase()
    items = items.filter((i) =>
      [i.customerName, i.customerEmail, i.subject, `#${i.displayNumber}`, i.proposalLine]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(needle)),
    )
  }
  const limit = Math.min(Number(q.limit) || 200, 500)
  return { ...list, items: items.slice(0, limit), nextCursor: null }
})
