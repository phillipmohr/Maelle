/** Postgres usage sink on Maelle's own database (server/utils/db.ts). */
import { dbQuery } from '../utils/db'
import type { UsageSink } from './types'

export function createDbUsageSink(): UsageSink {
  return {
    kind: 'db',
    async recordModelCall(c) {
      await dbQuery(
        `insert into public.model_calls (id, ticket_id, run_id, purpose, model, turn, attempt, status, stop_reason, error,
           input_tokens, cache_read_tokens, cache_creation_tokens, output_tokens, cost_usd, duration_ms, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, coalesce($17::timestamptz, now()))
         on conflict (id) do nothing`,
        [
          c.id,
          c.ticketId,
          c.runId,
          c.purpose,
          c.model,
          c.turn,
          c.attempt,
          c.status,
          c.stopReason,
          c.error,
          c.inputTokens,
          c.cacheReadTokens,
          c.cacheCreationTokens,
          c.outputTokens,
          c.costUsd,
          c.durationMs,
          c.createdAt ?? null,
        ],
      )
    },
    async recordToolCalls(calls) {
      for (const t of calls) {
        await dbQuery(
          `insert into public.agent_tool_calls (id, run_id, ticket_id, model_call_id, turn, tool, source, ok, input,
             result_chars, context_tokens, context_measured, duration_ms, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, coalesce($14::timestamptz, now()))
           on conflict (id) do nothing`,
          [
            t.id,
            t.runId,
            t.ticketId,
            t.modelCallId,
            t.turn,
            t.tool,
            t.source,
            t.ok,
            JSON.stringify(t.input ?? {}),
            t.resultChars,
            t.contextTokens,
            t.contextMeasured,
            t.durationMs,
            t.createdAt ?? null,
          ],
        )
      }
    },
    async setToolContextTokens(updates) {
      if (updates.length === 0) return
      await dbQuery(
        `update public.agent_tool_calls as t set context_tokens = u.tokens, context_measured = true
         from unnest($1::uuid[], $2::int[]) as u(id, tokens) where t.id = u.id`,
        [updates.map((u) => u.id), updates.map((u) => u.contextTokens)],
      )
    },
  }
}

let shared: UsageSink | null = null

/** One process-wide database sink (no state, so sharing is only about not re-creating it). */
export function dbUsageSink(): UsageSink {
  return (shared ??= createDbUsageSink())
}
