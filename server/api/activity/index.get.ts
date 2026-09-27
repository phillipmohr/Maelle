/** GET /api/activity — owner: IRDR-459. Foundation stub from the seed audit log. */
import type { ActivityItem, ActivityQuery, ActivityResponse } from '#shared/api'
import { seedExecutionRow } from '#shared/seed/views'
import { seedBundle, stubHeaders } from '../../utils/stubs'

export function seedActivity(): ActivityItem[] {
  const seed = seedBundle()
  const tickets = new Map(seed.tickets.map((t) => [t.id as string, t]))
  return seed.action_executions
    .map((e) => {
      const t = tickets.get(e.ticket_id as string)
      return {
        ...seedExecutionRow(e),
        ticketDisplayNumber: (t?.display_number as number) ?? 0,
        customerName: (t?.customer_name as string | null) ?? null,
      }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export default defineEventHandler((event): ActivityResponse => {
  stubHeaders(event, 'IRDR-459')
  const q = getQuery(event) as ActivityQuery
  let items = seedActivity()
  if (q.by) items = items.filter((i) => i.executedBy === q.by)
  if (String(q.irreversibleOnly) === 'true') items = items.filter((i) => i.irreversible)
  return { items: items.slice(0, Math.min(Number(q.limit) || 200, 500)), nextCursor: null }
})
