/**
 * Token usage against Postgres (pnpm test:db): the migration, the rows an agent run writes, the
 * ticket detail's usage block and the window aggregation of GET /api/usage.
 */
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDbForTests } from '../../../server/utils/db'
import { createDbAgentStore } from '../../../server/agent/store/db'
import { runAgent } from '../../../server/agent/run'
import { createDbUsageSink } from '../../../server/usage/db'
import { usageFromDb } from '../../../server/usage/query'
import { ticketDetailFromDb, type QueryExecutor } from '../../../shared/ticket-repository'
import { MODELS } from '../../../shared/config'
import { costUsd } from '../../../shared/pricing'
import { usageWindow } from '../../../shared/usage'
import { CASE_1_CANCELLATION } from '../../../evals/fixtures/cases'
import { NOW, SUPPORT } from '../../../evals/fixtures/worlds'
import { harnessDeps } from '../../../evals/harness'
import { SEED_APP_ID } from '../../../shared/seed/data'

const url = process.env.TEST_DATABASE_URL
const TURN_COST = costUsd(MODELS.agent, {
  inputTokens: 1000,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 200,
})!

describe.skipIf(!url)('token usage against Postgres', () => {
  let db: pg.Client
  /** The repository code runs its queries in parallel, which needs a pool, not one client. */
  let pool: pg.Pool
  let exec: QueryExecutor
  const store = createDbAgentStore()
  const created: string[] = []

  beforeAll(async () => {
    db = new pg.Client({ connectionString: url })
    await db.connect()
    pool = new pg.Pool({ connectionString: url, max: 4 })
    exec = async (text, params = []) => (await pool.query(text, params)).rows
  })
  afterAll(async () => {
    if (db && created.length > 0)
      await db.query('delete from public.tickets where id = any($1::uuid[])', [created])
    await db?.end()
    await pool?.end()
    await closeDbForTests()
  })

  async function insertTicket(): Promise<string> {
    const f = CASE_1_CANCELLATION
    const t = await db.query<{ id: string }>(
      `insert into public.tickets (app_id, customer_email, customer_name, subject, status, first_message_at, last_message_at, last_customer_message_at)
       values ($1, $2, $3, $4, 'new', $5, $5, $5) returning id`,
      [SEED_APP_ID, f.customer.email, f.customer.name, f.subject, f.messages[0]!.at],
    )
    const id = t.rows[0]!.id
    created.push(id)
    for (const m of f.messages)
      await db.query(
        `insert into public.messages (ticket_id, direction, from_email, from_name, to_emails, subject, text_body, received_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          id,
          m.direction,
          m.direction === 'in' ? f.customer.email : SUPPORT,
          m.direction === 'in' ? f.customer.name : 'Anastasia',
          [m.direction === 'in' ? SUPPORT : f.customer.email],
          f.subject,
          m.text,
          m.at,
        ],
      )
    return id
  }

  it('applied the usage migration', async () => {
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_name in ('model_calls', 'agent_tool_calls')`,
    )
    expect(tables.rows.map((r) => r.table_name).sort()).toEqual(['agent_tool_calls', 'model_calls'])
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'agent_runs' and column_name in ('cache_read_tokens', 'cache_creation_tokens', 'cost_usd')`,
    )
    expect(cols.rows).toHaveLength(3)
    const seeded = await db.query<{ n: number }>(
      `select count(*)::int as n from public.model_calls`,
    )
    expect(seeded.rows[0]!.n).toBeGreaterThan(0)
  })

  it('an agent run writes its turns and tool calls; the detail and the window read them back', async () => {
    const ticketId = await insertTicket()
    const before = await usageFromDb(exec, usageWindow(30, new Date()))
    const deps = {
      ...harnessDeps(CASE_1_CANCELLATION, store, { now: NOW }),
      usage: createDbUsageSink(),
    }
    const result = await runAgent(deps, ticketId, 'new_ticket', { jobId: `usage-${ticketId}` })
    expect(result.status, result.error).toBe('succeeded')

    const calls = await db.query(
      `select turn, purpose, status, input_tokens, output_tokens, cost_usd::float8 as cost_usd, attempt
       from public.model_calls where run_id = $1 order by turn`,
      [result.runId],
    )
    expect(calls.rows.length).toBeGreaterThanOrEqual(1)
    expect(calls.rows[0]).toMatchObject({
      turn: 1,
      purpose: 'agent_turn',
      status: 'ok',
      input_tokens: 1000,
      output_tokens: 200,
      attempt: 1,
    })
    expect(calls.rows[0]!.cost_usd).toBeCloseTo(TURN_COST, 6)
    const tools = await db.query(
      `select tool, ok, result_chars, context_tokens, context_measured from public.agent_tool_calls where run_id = $1 order by turn, created_at`,
      [result.runId],
    )
    expect(tools.rows.map((r) => r.tool)).toContain('submit_proposal')
    const run = await db.query(
      `select input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd::float8 as cost_usd from public.agent_runs where id = $1`,
      [result.runId],
    )
    expect(run.rows[0]).toMatchObject({
      input_tokens: 1000 * calls.rows.length,
      cache_read_tokens: 0,
    })
    expect(run.rows[0]!.cost_usd).toBeCloseTo(TURN_COST * calls.rows.length, 6)

    const detail = await ticketDetailFromDb(exec, ticketId)
    expect(detail!.usage!.totals.calls).toBe(calls.rows.length)
    expect(detail!.usage!.calls[0]!.purpose).toBe('agent_turn')
    expect(detail!.usage!.toolCalls.length).toBe(tools.rows.length)
    expect(detail!.runs[0]!.costUsd).toBeCloseTo(TURN_COST * calls.rows.length, 6)

    const usage = await usageFromDb(exec, usageWindow(30, new Date()))
    expect(usage.totals.calls).toBe(before.totals.calls + calls.rows.length)
    expect(usage.tickets).toBe(before.tickets + 1)
    expect(usage.runs).toBe(before.runs + 1)
    expect(usage.series).toHaveLength(30)
    expect(usage.series.at(-1)!.calls).toBeGreaterThanOrEqual(calls.rows.length)
    // the seed's tickets cost more than a scripted run, so the top list is sorted by cost, not membership
    expect(usage.topTickets.length).toBeLessThanOrEqual(10)
    expect(usage.topTickets[0]!.costUsd!).toBeGreaterThanOrEqual(usage.topTickets.at(-1)!.costUsd!)
    expect(usage.tools.some((t) => t.tool === 'submit_proposal')).toBe(true)
  })
})
