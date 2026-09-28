/**
 * Ticket list and detail from Maelle's database (IRDR-458). Pure: the caller passes a query
 * executor, so the same code runs inside the Nitro routes (`dbQuery`) and in `pnpm test:db` with a
 * plain `pg` client. The rows keep their column names, and the seed views turn them into the API
 * shapes, so the seed-backed offline mode and the database mode always agree.
 *
 * List semantics (GET /api/tickets):
 * - no `status`: every ticket, open ones first (needs decision, parked, auto), then closed by
 *   `closed_at desc`, up to `limit` (default 200). Search covers everything.
 * - `status=closed`: the history, `closed_at desc, id desc`, cursor paginated (`nextCursor`).
 * - `status=a,b`: those statuses only.
 */
import type { TicketListQuery, TicketListResponse, TicketDetailResponse } from './api'
import { isCaseType, type CaseType } from './case-types'
import type { SeedBundle } from './seed/data'
import { seedTicketDetail, seedTicketList } from './seed/views'
import {
  isTicketStatus,
  TICKET_RESOLUTIONS,
  type TicketResolution,
  type TicketStatus,
} from './status'

export type DbRow = Record<string, unknown>
export type QueryExecutor = (text: string, params?: unknown[]) => Promise<DbRow[]>

export const TICKET_LIST_DEFAULT_LIMIT = 200
export const TICKET_LIST_MAX_LIMIT = 500
/** Page size the inbox uses for the closed table. */
export const CLOSED_PAGE_SIZE = 40

export interface ClosedCursor {
  closedAt: string
  id: string
}

export interface ParsedTicketListQuery {
  statuses: TicketStatus[] | null
  q: string | null
  caseType: CaseType | null
  resolution: TicketResolution | null
  from: string | null
  to: string | null
  cursor: ClosedCursor | null
  limit: number
}

const b64 = {
  encode(s: string): string {
    const bytes = new TextEncoder().encode(s)
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  },
  decode(s: string): string {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  },
}

/** Opaque cursor for the closed table: `closed_at` and `id` of the last row of a page. */
export function encodeClosedCursor(c: ClosedCursor): string {
  return b64.encode(JSON.stringify([c.closedAt, c.id]))
}

export function decodeClosedCursor(s: string | null | undefined): ClosedCursor | null {
  if (!s) return null
  try {
    const v = JSON.parse(b64.decode(s)) as unknown
    if (!Array.isArray(v) || typeof v[0] !== 'string' || typeof v[1] !== 'string') return null
    if (Number.isNaN(Date.parse(v[0]))) return null
    return { closedAt: v[0], id: v[1] }
  } catch {
    return null
  }
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/** Turns the raw query string values into a typed, validated query. Unknown values are ignored. */
export function parseTicketListQuery(
  raw: TicketListQuery | Record<string, unknown>,
): ParsedTicketListQuery {
  const r = raw as Record<string, unknown>
  const statusRaw = typeof r.status === 'string' ? r.status : null
  let statuses: TicketStatus[] | null = null
  if (statusRaw && statusRaw !== 'all') {
    const list = statusRaw
      .split(',')
      .map((s) => s.trim())
      .filter(isTicketStatus)
    statuses = list.length > 0 ? [...new Set(list)] : null
  }
  const limitRaw = Number(r.limit)
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), TICKET_LIST_MAX_LIMIT)
      : TICKET_LIST_DEFAULT_LIMIT
  const q = typeof r.q === 'string' && r.q.trim() ? r.q.trim() : null
  const resolution =
    typeof r.resolution === 'string' &&
    (TICKET_RESOLUTIONS as readonly string[]).includes(r.resolution)
      ? (r.resolution as TicketResolution)
      : null
  return {
    statuses,
    q,
    caseType: isCaseType(r.caseType) ? r.caseType : null,
    resolution,
    from: isoOrNull(r.from),
    to: isoOrNull(r.to),
    cursor: typeof r.cursor === 'string' ? decodeClosedCursor(r.cursor) : null,
    limit,
  }
}

/** True when the query is the closed history, which is the only paginated list. */
export function isClosedOnly(q: ParsedTicketListQuery): boolean {
  return q.statuses?.length === 1 && q.statuses[0] === 'closed'
}

/** pg gives Date objects for timestamps; the API (and the seed views) want ISO strings. */
export function normalizeDbRow(row: DbRow): DbRow {
  const out: DbRow = {}
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v
  return out
}

export function emptyBundle(): SeedBundle {
  return {
    apps: [],
    allowed_users: [],
    tickets: [],
    messages: [],
    agent_runs: [],
    proposals: [],
    proposed_actions: [],
    action_executions: [],
    decisions: [],
    release_notifications: [],
    cancellation_reasons: [],
    settings: [],
    autonomy_modes: [],
    action_locks: [],
  }
}

const TICKET_COLUMNS = `t.id, t.app_id, t.display_number, t.customer_email, t.customer_name, t.subject,
  t.status, t.resolution, t.case_type, t.case_confidence, t.risk_level, t.risk_reason,
  t.due_date::text as due_date, t.stage, t.waiting_for, t.snoozed_until, t.tags, t.instaradar_user_id,
  t.stripe_customer_id, t.customer_context, t.first_message_at, t.last_message_at,
  t.last_customer_message_at, t.closed_at, t.created_at, t.updated_at`

export const OPEN_STATUS_SQL = `('new','researching','needs_decision','executing','action_failed','manual')`

/** SQL for the filtered, ordered ticket page (one extra row tells whether there is a next page). */
export function ticketListSql(q: ParsedTicketListQuery): { text: string; params: unknown[] } {
  const params: unknown[] = []
  const where: string[] = []
  const p = (v: unknown) => {
    params.push(v)
    return `$${params.length}`
  }
  if (q.statuses) where.push(`t.status = any(${p(q.statuses)}::text[])`)
  if (q.caseType) where.push(`t.case_type = ${p(q.caseType)}`)
  if (q.resolution) where.push(`t.resolution = ${p(q.resolution)}`)
  if (q.from) where.push(`t.closed_at >= ${p(q.from)}::timestamptz`)
  if (q.to) where.push(`t.closed_at <= ${p(q.to)}::timestamptz`)
  if (q.q) {
    const like = p(`%${q.q.replace(/^#/, '').replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
    where.push(
      `(t.customer_name ilike ${like} or t.customer_email ilike ${like} or t.subject ilike ${like}
        or t.display_number::text like ${like}
        or exists (select 1 from public.proposals p where p.ticket_id = t.id and p.summary_line ilike ${like}))`,
    )
  }
  const closedOnly = isClosedOnly(q)
  if (closedOnly && q.cursor) {
    where.push(
      `(t.closed_at, t.id) < (${p(q.cursor.closedAt)}::timestamptz, ${p(q.cursor.id)}::uuid)`,
    )
  }
  const order = closedOnly
    ? `t.closed_at desc, t.id desc`
    : `(t.status = 'closed') asc, t.closed_at desc nulls last, t.created_at asc, t.id desc`
  const text = `select ${TICKET_COLUMNS} from public.tickets t
    ${where.length ? `where ${where.join(' and ')}` : ''}
    order by ${order}
    limit ${p(q.limit + 1)}`
  return { text, params }
}

export function ticketCountsSql(now: Date): { text: string; params: unknown[] } {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3_600_000)
  return {
    text: `select
      count(*) filter (where status in ${OPEN_STATUS_SQL})::int as needs_decision,
      count(*) filter (where status = 'waiting_on_customer')::int as waiting_on_customer,
      count(*) filter (where status = 'snoozed')::int as snoozed,
      count(*) filter (where status = 'auto_pending')::int as auto_pending,
      count(*) filter (where status = 'closed' and closed_at > $1::timestamptz)::int as closed_last_3_days,
      count(*) filter (where status = 'closed' and closed_at >= $2::timestamptz)::int as closed_today
      from public.tickets`,
    params: [threeDaysAgo.toISOString(), startOfToday.toISOString()],
  }
}

async function relatedRowsForList(exec: QueryExecutor, ticketIds: string[]) {
  if (ticketIds.length === 0) {
    return {
      proposals: [],
      proposed_actions: [],
      agent_runs: [],
      decisions: [],
      action_executions: [],
    }
  }
  const [proposals, agent_runs, decisions, action_executions] = await Promise.all([
    exec(
      `select id, ticket_id, version, summary_line from public.proposals where ticket_id = any($1::uuid[])`,
      [ticketIds],
    ),
    exec(
      `select id, ticket_id, progress, created_at from public.agent_runs where ticket_id = any($1::uuid[])`,
      [ticketIds],
    ),
    exec(
      `select id, ticket_id, decision, note, decided_at from public.decisions where ticket_id = any($1::uuid[])`,
      [ticketIds],
    ),
    exec(
      `select id, ticket_id, action_type, status, result, external_refs, created_at
       from public.action_executions where ticket_id = any($1::uuid[])`,
      [ticketIds],
    ),
  ])
  const proposalIds = proposals.map((p) => p.id as string)
  const proposed_actions =
    proposalIds.length > 0
      ? await exec(
          `select id, proposal_id, position, enabled from public.proposed_actions where proposal_id = any($1::uuid[])`,
          [proposalIds],
        )
      : []
  return { proposals, proposed_actions, agent_runs, decisions, action_executions }
}

/** GET /api/tickets against the database. */
export async function ticketListFromDb(
  exec: QueryExecutor,
  query: ParsedTicketListQuery,
  now: Date = new Date(),
): Promise<TicketListResponse> {
  const list = ticketListSql(query)
  const counts = ticketCountsSql(now)
  const [pageRows, countRows] = await Promise.all([
    exec(list.text, list.params),
    exec(counts.text, counts.params),
  ])
  const hasMore = pageRows.length > query.limit
  const tickets = pageRows.slice(0, query.limit).map(normalizeDbRow)
  const related = await relatedRowsForList(
    exec,
    tickets.map((t) => t.id as string),
  )
  const bundle: SeedBundle = {
    ...emptyBundle(),
    tickets,
    proposals: related.proposals.map(normalizeDbRow),
    proposed_actions: related.proposed_actions.map(normalizeDbRow),
    agent_runs: related.agent_runs.map(normalizeDbRow),
    decisions: related.decisions.map(normalizeDbRow),
    action_executions: related.action_executions.map(normalizeDbRow),
  }
  const view = seedTicketList(bundle, now)
  const c = (countRows[0] ?? {}) as Record<string, number>
  const last = tickets[tickets.length - 1]
  const nextCursor =
    hasMore && isClosedOnly(query) && last && typeof last.closed_at === 'string'
      ? encodeClosedCursor({ closedAt: last.closed_at, id: last.id as string })
      : null
  return {
    items: view.items,
    nextCursor,
    counts: {
      needsDecision: c.needs_decision ?? 0,
      waitingOnCustomer: c.waiting_on_customer ?? 0,
      snoozed: c.snoozed ?? 0,
      autoPending: c.auto_pending ?? 0,
      closedLast3Days: c.closed_last_3_days ?? 0,
      closedToday: c.closed_today ?? 0,
    },
  }
}

/** GET /api/tickets/:id against the database. `id` is the uuid or the display number ("4825", "#4825"). */
export async function ticketDetailFromDb(
  exec: QueryExecutor,
  idOrNumber: string,
): Promise<TicketDetailResponse | null> {
  const key = idOrNumber.trim().replace(/^#/, '')
  if (!key) return null
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
  const ticketRows = await exec(
    `select ${TICKET_COLUMNS} from public.tickets t where ${isUuid ? 't.id = $1::uuid' : 't.display_number::text = $1'} limit 1`,
    [key],
  )
  const ticket = ticketRows[0]
  if (!ticket) return null
  const id = ticket.id as string
  const [messages, proposals, action_executions, decisions, agent_runs] = await Promise.all([
    exec(
      `select id, ticket_id, direction, from_email, from_name, to_emails, subject, text_body, text_stripped, html_body,
        translation, attachments, received_at, sent_at, sent_by, created_at
       from public.messages where ticket_id = $1 order by created_at`,
      [id],
    ),
    exec(
      `select id, ticket_id, run_id, version, case_type, confidence, candidate_cases, summary_line,
        meta_line, risk_level, risk_reason, due_date::text as due_date, customer_confirmation_needed,
        stage, research, research_warnings, policy_warnings, conclusion, reply_draft, knowledge_refs,
        no_knowledge_found, status, created_at
       from public.proposals where ticket_id = $1 order by version desc`,
      [id],
    ),
    exec(
      `select id, ticket_id, proposal_id, action_type, params, executed_by, status, scheduled_for,
        idempotency_key, attempt, result, error, external_refs, irreversible, started_at, finished_at,
        created_at
       from public.action_executions where ticket_id = $1 order by created_at`,
      [id],
    ),
    exec(
      `select id, ticket_id, proposal_id, decision, reject_reason, note, reply_diff, action_changes,
        time_to_decide_ms, decided_at
       from public.decisions where ticket_id = $1 order by decided_at desc`,
      [id],
    ),
    exec(
      `select id, ticket_id, trigger, status, progress, started_at, finished_at, duration_ms, model,
        error, proposal_id, created_at
       from public.agent_runs where ticket_id = $1 order by created_at desc`,
      [id],
    ),
  ])
  const proposalIds = proposals.map((p) => p.id as string)
  const proposed_actions =
    proposalIds.length > 0
      ? await exec(
          `select id, proposal_id, position, action_type, params, reason, stage, required_for_reply, enabled
           from public.proposed_actions where proposal_id = any($1::uuid[]) order by position`,
          [proposalIds],
        )
      : []
  const bundle: SeedBundle = {
    ...emptyBundle(),
    tickets: [normalizeDbRow(ticket)],
    messages: messages.map(normalizeDbRow),
    proposals: proposals.map(normalizeDbRow),
    proposed_actions: proposed_actions.map(normalizeDbRow),
    action_executions: action_executions.map(normalizeDbRow),
    decisions: decisions.map(normalizeDbRow),
    agent_runs: agent_runs.map(normalizeDbRow),
  }
  return seedTicketDetail(bundle, id)
}
