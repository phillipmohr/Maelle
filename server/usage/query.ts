/**
 * GET /api/usage against the database: the calls and tool calls of the window are loaded and
 * aggregated with the same code the seed route uses (`aggregateUsage`). A few thousand rows per
 * month at Maelle's volume, so one pass in memory beats five grouping queries that would have to
 * agree with the seed variant.
 */
import type { UsageResponse } from '#shared/api'
import type { CaseType } from '#shared/case-types'
import type { QueryExecutor } from '#shared/ticket-repository'
import {
  aggregateUsage,
  modelCallFromRow,
  toolCallFromRow,
  type TicketInfo,
  type UsageWindow,
} from '#shared/usage'

export async function usageFromDb(
  exec: QueryExecutor,
  window: UsageWindow,
): Promise<UsageResponse> {
  const from = window.from.toISOString()
  const to = window.to.toISOString()
  const [callRows, toolRows] = await Promise.all([
    exec(
      `select id, ticket_id, run_id, purpose, model, turn, attempt, status, stop_reason, error,
        input_tokens, cache_read_tokens, cache_creation_tokens, output_tokens, cost_usd::float8 as cost_usd,
        duration_ms, created_at
       from public.model_calls where created_at >= $1::timestamptz and created_at < $2::timestamptz`,
      [from, to],
    ),
    exec(
      `select t.id, t.run_id, t.ticket_id, t.model_call_id, t.turn, t.tool, t.source, t.ok, t.input,
        t.result_chars, t.context_tokens, t.context_measured, t.duration_ms, t.created_at
       from public.agent_tool_calls t
       where t.created_at >= $1::timestamptz and t.created_at < $2::timestamptz`,
      [from, to],
    ),
  ])
  const calls = callRows.map(modelCallFromRow)
  const toolCalls = toolRows.map(toolCallFromRow)
  const ticketIds = [...new Set(calls.map((c) => c.ticketId).filter((x): x is string => !!x))]
  const info = new Map<string, TicketInfo>()
  if (ticketIds.length > 0) {
    const rows = await exec(
      `select id, display_number, customer_name, case_type from public.tickets where id = any($1::uuid[])`,
      [ticketIds],
    )
    for (const r of rows)
      info.set(String(r.id), {
        displayNumber: r.display_number == null ? null : Number(r.display_number),
        customerName: (r.customer_name as string | null) ?? null,
        caseType: (r.case_type as CaseType | null) ?? null,
      })
  }
  return aggregateUsage(window, calls, toolCalls, (id) => info.get(id) ?? null)
}
