/**
 * Activity log queries: action_executions joined with tickets, filtered by who ran it and
 * irreversible only, cursor pagination (created_at desc, id desc), plus the settings_audit rows of
 * the same time range as "Settings" entries. The seed variant answers when no database is configured.
 */
import type {
  ActionExecutionRow,
  ActivityItem,
  ActivityResponse,
  ExecutedBy,
  SettingsAuditItem,
} from '#shared/api'
import type { SeedBundle } from '#shared/seed/data'
import { seedExecutionRow } from '#shared/seed/views'
import { dbQuery } from '../utils/db'
import { iso } from './app'
import { loadSettingsAudit } from './repo'

type Row = Record<string, unknown>

export const ACTIVITY_DEFAULT_LIMIT = 100
export const ACTIVITY_MAX_LIMIT = 500

export interface ActivityCursor {
  createdAt: string
  id: string
}

export interface ActivityFilters {
  by: ExecutedBy | null
  irreversibleOnly: boolean
  from: string | null
  to: string | null
  includeSettings: boolean
  limit: number
  cursor: ActivityCursor | null
}

export function encodeCursor(c: ActivityCursor): string {
  return Buffer.from(JSON.stringify([c.createdAt, c.id])).toString('base64url')
}

export function decodeCursor(s: unknown): ActivityCursor | null {
  if (typeof s !== 'string' || !s) return null
  try {
    const parsed = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [createdAt, id] = parsed as [unknown, unknown]
    if (typeof createdAt !== 'string' || typeof id !== 'string') return null
    if (Number.isNaN(new Date(createdAt).getTime())) return null
    return { createdAt, id }
  } catch {
    return null
  }
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Query string → filters. Unknown values are ignored, never thrown. */
export function parseActivityQuery(q: Record<string, unknown>): ActivityFilters {
  const by = q.by === 'you' || q.by === 'auto' ? (q.by as ExecutedBy) : null
  const irreversibleOnly = String(q.irreversibleOnly) === 'true'
  const requestedLimit = Number(q.limit)
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(Math.floor(requestedLimit), ACTIVITY_MAX_LIMIT)
      : ACTIVITY_DEFAULT_LIMIT
  const includeSettings =
    q.includeSettings === undefined
      ? by !== 'auto' && !irreversibleOnly
      : String(q.includeSettings) === 'true' && by !== 'auto' && !irreversibleOnly
  return {
    by,
    irreversibleOnly,
    from: isoOrNull(q.from),
    to: isoOrNull(q.to),
    includeSettings,
    limit,
    cursor: decodeCursor(q.cursor),
  }
}

export function executionFromDb(r: Row): ActivityItem {
  return {
    id: String(r.id),
    ticketId: String(r.ticket_id),
    proposalId: (r.proposal_id as string | null) ?? null,
    type: r.action_type as ActionExecutionRow['type'],
    params: (r.params as Record<string, unknown> | null) ?? {},
    executedBy: r.executed_by as ExecutedBy,
    status: r.status as ActionExecutionRow['status'],
    scheduledFor: iso(r.scheduled_for),
    idempotencyKey: String(r.idempotency_key),
    attempt: Number(r.attempt ?? 1),
    result: r.result ?? null,
    error: (r.error as string | null) ?? null,
    externalRefs: (r.external_refs as Record<string, string> | null) ?? {},
    irreversible: Boolean(r.irreversible),
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    createdAt: iso(r.created_at)!,
    ticketDisplayNumber: Number(r.display_number),
    customerName: (r.customer_name as string | null) ?? null,
  }
}

/** One page of the log. Settings entries cover the same time range as the items of the page. */
export async function queryActivity(
  appId: string,
  f: ActivityFilters,
): Promise<ActivityResponse & { settings: SettingsAuditItem[] }> {
  const rows = await dbQuery<Row>(
    `select e.*, t.display_number, t.customer_name
     from public.action_executions e
     join public.tickets t on t.id = e.ticket_id
     where t.app_id = $1
       and ($2::text is null or e.executed_by = $2)
       and ($3::boolean = false or e.irreversible)
       and ($4::timestamptz is null or e.created_at >= $4)
       and ($5::timestamptz is null or e.created_at <= $5)
       and ($6::timestamptz is null or (e.created_at, e.id) < ($6::timestamptz, $7::uuid))
     order by e.created_at desc, e.id desc
     limit $8`,
    [
      appId,
      f.by,
      f.irreversibleOnly,
      f.from,
      f.to,
      f.cursor?.createdAt ?? null,
      f.cursor?.id ?? '00000000-0000-0000-0000-000000000000',
      f.limit + 1,
    ],
  )
  const hasMore = rows.length > f.limit
  const items = rows.slice(0, f.limit).map(executionFromDb)
  const last = items[items.length - 1]
  const nextCursor =
    hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null

  let settings: SettingsAuditItem[] = []
  if (f.includeSettings) {
    settings = await loadSettingsAudit(appId, {
      before: f.cursor?.createdAt ?? f.to,
      from: hasMore && last ? maxIso(last.createdAt, f.from) : f.from,
      to: f.cursor ? null : f.to,
    })
  }
  return { items, nextCursor, settings }
}

function maxIso(a: string, b: string | null): string {
  return b && b > a ? b : a
}

/** Everything matching the filters (for the CSV export), capped so a runaway export stays bounded. */
export async function queryAllActivity(
  appId: string,
  f: ActivityFilters,
  cap = 5000,
): Promise<{ items: ActivityItem[]; settings: SettingsAuditItem[] }> {
  const items: ActivityItem[] = []
  let cursor: ActivityCursor | null = null
  while (items.length < cap) {
    const page: ActivityResponse = await queryActivity(appId, {
      ...f,
      includeSettings: false,
      limit: ACTIVITY_MAX_LIMIT,
      cursor,
    })
    items.push(...page.items)
    const next = decodeCursor(page.nextCursor)
    if (!next) break
    cursor = next
  }
  const settings = f.includeSettings
    ? await loadSettingsAudit(appId, { from: f.from, to: f.to }, 1000)
    : []
  return { items: items.slice(0, cap), settings }
}

// ---------------------------------------------------------------- seed fallback (offline dev server)

export function seedActivity(seed: SeedBundle): ActivityItem[] {
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
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

export function filterSeedActivity(items: ActivityItem[], f: ActivityFilters): ActivityItem[] {
  let out = items
  if (f.by) out = out.filter((i) => i.executedBy === f.by)
  if (f.irreversibleOnly) out = out.filter((i) => i.irreversible)
  if (f.from) out = out.filter((i) => i.createdAt >= f.from!)
  if (f.to) out = out.filter((i) => i.createdAt <= f.to!)
  if (f.cursor) {
    const c = f.cursor
    out = out.filter(
      (i) => i.createdAt < c.createdAt || (i.createdAt === c.createdAt && i.id < c.id),
    )
  }
  return out
}

export function seedActivityResponse(
  seed: SeedBundle,
  f: ActivityFilters,
): ActivityResponse & { settings: SettingsAuditItem[] } {
  const all = filterSeedActivity(seedActivity(seed), f)
  const items = all.slice(0, f.limit)
  const last = items[items.length - 1]
  return {
    items,
    nextCursor:
      all.length > f.limit && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
    settings: [],
  }
}

// ---------------------------------------------------------------- CSV

export function csvCell(v: unknown): string {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const ACTIVITY_CSV_HEADER = [
  'time',
  'kind',
  'action',
  'parameters',
  'ticket',
  'by',
  'status',
  'irreversible',
  'error',
  'external_refs',
] as const
