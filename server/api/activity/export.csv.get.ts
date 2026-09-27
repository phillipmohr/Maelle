/** GET /api/activity/export.csv — owner: IRDR-459. Foundation stub from the seed audit log. */
import { actionLabel } from '#shared/actions'
import { seedActivity } from './index.get'
import { stubHeaders } from '../../utils/stubs'

function csvCell(v: unknown): string {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default defineEventHandler((event) => {
  stubHeaders(event, 'IRDR-459')
  const rows = seedActivity()
  const header = [
    'time',
    'action',
    'parameters',
    'ticket',
    'by',
    'status',
    'irreversible',
    'error',
    'external_refs',
  ]
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.createdAt,
        actionLabel(r.type),
        r.params,
        `#${r.ticketDisplayNumber}`,
        r.executedBy,
        r.status,
        r.irreversible,
        r.error,
        r.externalRefs,
      ]
        .map(csvCell)
        .join(','),
    )
  }
  setHeader(event, 'content-type', 'text/csv; charset=utf-8')
  setHeader(
    event,
    'content-disposition',
    `attachment; filename="maelle-activity-${new Date().toISOString().slice(0, 10)}.csv"`,
  )
  return lines.join('\n') + '\n'
})
