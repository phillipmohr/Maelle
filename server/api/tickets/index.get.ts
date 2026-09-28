/**
 * GET /api/tickets — owner: IRDR-458 (UI).
 * Query: status (comma separated, or `all`), q, caseType, resolution, from, to, cursor, limit.
 *
 * - no `status`: every ticket, open ones first, then closed by `closed_at desc`, up to `limit`
 *   (default 200), so the palette search covers everything and the inbox gets its open rows.
 * - `status=closed`: the history, `closed_at desc, id desc`, cursor paginated (`nextCursor`).
 *
 * Reads the database when it is configured, otherwise the seed views (offline dev, screenshots).
 */
import type { TicketListResponse } from '#shared/api'
import { seedTicketList } from '#shared/seed/views'
import {
  isClosedOnly,
  parseTicketListQuery,
  ticketListFromDb,
  encodeClosedCursor,
} from '#shared/ticket-repository'
import { dbQuery, isDbConfigured } from '../../utils/db'
import { seedBundle, stubHeaders } from '../../utils/stubs'

export default defineEventHandler(async (event): Promise<TicketListResponse> => {
  const q = parseTicketListQuery(getQuery(event) as Record<string, unknown>)

  if (isDbConfigured()) {
    return ticketListFromDb((text, params) => dbQuery(text, params ?? []), q)
  }

  stubHeaders(event, 'IRDR-458')
  const list = seedTicketList(seedBundle())
  let items = list.items
  if (q.statuses) items = items.filter((i) => q.statuses!.includes(i.status))
  if (q.caseType) items = items.filter((i) => i.caseType === q.caseType)
  if (q.resolution) items = items.filter((i) => i.resolution === q.resolution)
  if (q.from) items = items.filter((i) => i.closedAt != null && i.closedAt >= q.from!)
  if (q.to) items = items.filter((i) => i.closedAt != null && i.closedAt <= q.to!)
  if (q.q) {
    const needle = q.q.toLowerCase().replace(/^#/, '')
    items = items.filter((i) =>
      [i.customerName, i.customerEmail, i.subject, String(i.displayNumber), i.proposalLine]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(needle)),
    )
  }
  const closedOnly = isClosedOnly(q)
  items = [...items].sort((a, b) => {
    if (closedOnly) {
      return (b.closedAt ?? '').localeCompare(a.closedAt ?? '') || b.id.localeCompare(a.id)
    }
    const ca = a.status === 'closed' ? 1 : 0
    const cb = b.status === 'closed' ? 1 : 0
    if (ca !== cb) return ca - cb
    if (ca === 1) return (b.closedAt ?? '').localeCompare(a.closedAt ?? '')
    return a.createdAt.localeCompare(b.createdAt)
  })
  if (closedOnly && q.cursor) {
    const c = q.cursor
    items = items.filter((i) => {
      const at = i.closedAt ?? ''
      return at < c.closedAt || (at === c.closedAt && i.id < c.id)
    })
  }
  const page = items.slice(0, q.limit)
  const last = page[page.length - 1]
  const nextCursor =
    closedOnly && items.length > q.limit && last?.closedAt
      ? encodeClosedCursor({ closedAt: last.closedAt, id: last.id })
      : null
  return { ...list, items: page, nextCursor }
})
