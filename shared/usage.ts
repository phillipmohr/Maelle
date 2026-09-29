/**
 * Token usage arithmetic shared by the server (ticket detail, GET /api/usage) and the UI: totals,
 * grouping, the window aggregation and the row mappers. Pure functions over `ModelCallRow` and
 * `ToolCallRow`, so the database route and the seed route share one implementation.
 */
import type {
  ModelCallPurpose,
  ModelCallRow,
  TicketUsage,
  ToolCallRow,
  UsageDay,
  UsageResponse,
  UsageTicketStat,
  UsageToolStat,
  UsageTotals,
} from './api'
import { addCost } from './pricing'

export const MODEL_CALL_PURPOSES: readonly ModelCallPurpose[] = [
  'agent_turn',
  'consistency_check',
  'kb_condensation',
  'history_classification',
  'eval',
]

export const PURPOSE_LABEL: Record<ModelCallPurpose, string> = {
  agent_turn: 'Agent runs',
  consistency_check: 'Consistency checks',
  kb_condensation: 'KB drafts',
  history_classification: 'History classification',
  eval: 'Evals',
}

export const USAGE_DEFAULT_DAYS = 30
export const USAGE_MAX_DAYS = 365
export const USAGE_TOP_TICKETS = 10

/** Estimate when the next turn never came: roughly four characters per token of JSON. */
export function estimateContextTokens(resultChars: number): number {
  return Math.round(resultChars / 4)
}

export function emptyTotals(): UsageTotals {
  return {
    calls: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  }
}

type Priced = Pick<
  ModelCallRow,
  'inputTokens' | 'cacheReadTokens' | 'cacheCreationTokens' | 'outputTokens' | 'costUsd'
>

/** Adds one call to the totals in place and returns them. */
export function addToTotals(t: UsageTotals, c: Priced): UsageTotals {
  t.calls++
  t.inputTokens += c.inputTokens
  t.cacheReadTokens += c.cacheReadTokens
  t.cacheCreationTokens += c.cacheCreationTokens
  t.outputTokens += c.outputTokens
  t.costUsd = addCost(t.costUsd, c.costUsd)
  return t
}

export function totalsOf(calls: readonly Priced[]): UsageTotals {
  const t = emptyTotals()
  for (const c of calls) addToTotals(t, c)
  return t
}

export function mergeTotals(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    calls: a.calls + b.calls,
    inputTokens: a.inputTokens + b.inputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    costUsd: addCost(a.costUsd, b.costUsd),
  }
}

/** Everything the model read across the calls: uncached input plus both cache kinds. */
export function totalInputTokens(t: UsageTotals): number {
  return t.inputTokens + t.cacheReadTokens + t.cacheCreationTokens
}

/** Share of the input that came from the cache (0..1), null without input. */
export function cacheShare(t: UsageTotals): number | null {
  const all = totalInputTokens(t)
  return all > 0 ? t.cacheReadTokens / all : null
}

export function groupTotals<K extends string>(
  calls: readonly ModelCallRow[],
  key: (c: ModelCallRow) => K,
): Partial<Record<K, UsageTotals>> {
  const out: Partial<Record<K, UsageTotals>> = {}
  for (const c of calls) {
    const k = key(c)
    out[k] = addToTotals(out[k] ?? emptyTotals(), c)
  }
  return out
}

/** The ticket detail's usage block from its rows (any order; sorted newest first here). */
export function ticketUsageFromRows(
  calls: readonly ModelCallRow[],
  toolCalls: readonly ToolCallRow[],
): TicketUsage {
  const sorted = [...calls].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return {
    totals: totalsOf(sorted),
    byPurpose: groupTotals(sorted, (c) => c.purpose),
    calls: sorted,
    toolCalls: [...toolCalls].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.turn - b.turn,
    ),
  }
}

// ---------------------------------------------------------------- window aggregation (GET /api/usage)

export interface UsageWindow {
  days: number
  /** Inclusive start (ISO). */
  from: Date
  /** Exclusive end (ISO), usually now. */
  to: Date
}

/** `days` clamped to 1..USAGE_MAX_DAYS; the window starts at local midnight `days - 1` days ago. */
export function usageWindow(daysRaw: unknown, now: Date = new Date()): UsageWindow {
  const n = Number(daysRaw)
  const days =
    Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), USAGE_MAX_DAYS) : USAGE_DEFAULT_DAYS
  const from = new Date(now)
  from.setHours(0, 0, 0, 0)
  from.setDate(from.getDate() - (days - 1))
  return { days, from, to: now }
}

/** Local calendar date of an ISO timestamp, YYYY-MM-DD. */
export function localDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface TicketInfo {
  displayNumber: number | null
  customerName: string | null
  caseType: UsageTicketStat['caseType']
}

/**
 * Aggregates the calls of a window. `ticketInfo` resolves the top tickets' display data; the caller
 * passes rows already limited to the window (`created_at >= from`).
 */
export function aggregateUsage(
  window: UsageWindow,
  calls: readonly ModelCallRow[],
  toolCalls: readonly ToolCallRow[],
  ticketInfo: (ticketId: string) => TicketInfo | null = () => null,
): UsageResponse {
  const inWindow = calls.filter((c) => {
    const t = new Date(c.createdAt).getTime()
    return t >= window.from.getTime() && t < window.to.getTime()
  })
  const totals = totalsOf(inWindow)
  const tickets = new Set(inWindow.map((c) => c.ticketId).filter((x): x is string => !!x))
  const runs = new Set(inWindow.map((c) => c.runId).filter((x): x is string => !!x))

  // one entry per day, oldest first
  const byDay = new Map<string, UsageDay>()
  for (let i = 0; i < window.days; i++) {
    const d = new Date(window.from)
    d.setDate(d.getDate() + i)
    const date = localDate(d.toISOString())
    byDay.set(date, { ...emptyTotals(), date, tickets: 0 })
  }
  const dayTickets = new Map<string, Set<string>>()
  for (const c of inWindow) {
    const date = localDate(c.createdAt)
    const day = byDay.get(date)
    if (!day) continue
    addToTotals(day, c)
    if (c.ticketId) {
      const set = dayTickets.get(date) ?? new Set<string>()
      set.add(c.ticketId)
      dayTickets.set(date, set)
      day.tickets = set.size
    }
  }

  const byModelMap = groupTotals(inWindow, (c) => c.model)
  const byModel = Object.entries(byModelMap)
    .map(([model, t]) => ({ model, totals: t! }))
    .sort((a, b) => (b.totals.costUsd ?? 0) - (a.totals.costUsd ?? 0))

  // tools: only the tool calls of turns inside the window
  const callIds = new Set(inWindow.map((c) => c.id))
  const toolMap = new Map<string, UsageToolStat & { durations: number[] }>()
  for (const t of toolCalls) {
    if (t.modelCallId && !callIds.has(t.modelCallId)) continue
    if (!t.modelCallId) {
      const at = new Date(t.createdAt).getTime()
      if (at < window.from.getTime() || at >= window.to.getTime()) continue
    }
    const s = toolMap.get(t.tool) ?? {
      tool: t.tool,
      calls: 0,
      failed: 0,
      contextTokens: 0,
      avgContextTokens: null,
      avgDurationMs: null,
      durations: [],
    }
    s.calls++
    if (!t.ok) s.failed++
    s.contextTokens += t.contextTokens ?? estimateContextTokens(t.resultChars)
    if (t.durationMs != null) s.durations.push(t.durationMs)
    toolMap.set(t.tool, s)
  }
  const tools: UsageToolStat[] = [...toolMap.values()]
    .map(({ durations, ...s }) => ({
      ...s,
      avgContextTokens: s.calls ? Math.round(s.contextTokens / s.calls) : null,
      avgDurationMs: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null,
    }))
    .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool))

  const perTicket = new Map<string, UsageTicketStat & { runIds: Set<string> }>()
  for (const c of inWindow) {
    if (!c.ticketId) continue
    const info = ticketInfo(c.ticketId)
    const s = perTicket.get(c.ticketId) ?? {
      ...emptyTotals(),
      ticketId: c.ticketId,
      displayNumber: info?.displayNumber ?? null,
      customerName: info?.customerName ?? null,
      caseType: info?.caseType ?? null,
      runs: 0,
      runIds: new Set<string>(),
    }
    addToTotals(s, c)
    if (c.runId) s.runIds.add(c.runId)
    s.runs = s.runIds.size
    perTicket.set(c.ticketId, s)
  }
  const topTickets: UsageTicketStat[] = [...perTicket.values()]
    .map(({ runIds: _r, ...s }) => s)
    .sort(
      (a, b) =>
        (b.costUsd ?? 0) - (a.costUsd ?? 0) ||
        totalInputTokens(b) + b.outputTokens - (totalInputTokens(a) + a.outputTokens),
    )
    .slice(0, USAGE_TOP_TICKETS)

  return {
    days: window.days,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    totals,
    tickets: tickets.size,
    runs: runs.size,
    byPurpose: groupTotals(inWindow, (c) => c.purpose),
    byModel,
    series: [...byDay.values()],
    tools,
    topTickets,
  }
}

// ---------------------------------------------------------------- row mappers (snake_case rows → API shapes)

type Row = Record<string, unknown>

function isoOf(v: unknown): string {
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** A `model_calls` row (pg returns numeric as text and timestamptz as Date). */
export function modelCallFromRow(r: Row): ModelCallRow {
  return {
    id: String(r.id),
    ticketId: (r.ticket_id as string | null) ?? null,
    runId: (r.run_id as string | null) ?? null,
    purpose: r.purpose as ModelCallPurpose,
    model: String(r.model),
    turn: numOrNull(r.turn),
    attempt: numOrNull(r.attempt),
    status: (r.status as ModelCallRow['status']) ?? 'ok',
    stopReason: (r.stop_reason as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    inputTokens: numOrNull(r.input_tokens) ?? 0,
    cacheReadTokens: numOrNull(r.cache_read_tokens) ?? 0,
    cacheCreationTokens: numOrNull(r.cache_creation_tokens) ?? 0,
    outputTokens: numOrNull(r.output_tokens) ?? 0,
    costUsd: numOrNull(r.cost_usd),
    durationMs: numOrNull(r.duration_ms),
    createdAt: isoOf(r.created_at),
  }
}

/** An `agent_tool_calls` row. */
export function toolCallFromRow(r: Row): ToolCallRow {
  return {
    id: String(r.id),
    runId: (r.run_id as string | null) ?? null,
    ticketId: (r.ticket_id as string | null) ?? null,
    modelCallId: (r.model_call_id as string | null) ?? null,
    turn: numOrNull(r.turn) ?? 0,
    tool: String(r.tool),
    source: (r.source as string | null) ?? null,
    ok: r.ok !== false,
    input: (r.input as Record<string, unknown> | null) ?? {},
    resultChars: numOrNull(r.result_chars) ?? 0,
    contextTokens: numOrNull(r.context_tokens),
    contextMeasured: r.context_measured === true,
    durationMs: numOrNull(r.duration_ms),
    createdAt: isoOf(r.created_at),
  }
}
