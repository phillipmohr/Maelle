/** Usage arithmetic: ticket totals, the window aggregation behind GET /api/usage, the row mappers. */
import { describe, expect, it } from 'vitest'
import type { ModelCallRow, ToolCallRow } from '../../shared/api'
import { splitContextTokens } from '../../server/agent/loop'
import { buildSeed } from '../../shared/seed/data'
import { seedTicketDetail, seedUsageResponse } from '../../shared/seed/views'
import {
  aggregateUsage,
  cacheShare,
  estimateContextTokens,
  modelCallFromRow,
  ticketUsageFromRows,
  toolCallFromRow,
  totalsOf,
  usageWindow,
} from '../../shared/usage'

const now = new Date('2026-09-27T10:00:00')

function call(partial: Partial<ModelCallRow> & { id: string; createdAt: string }): ModelCallRow {
  return {
    ticketId: 't1',
    runId: 'r1',
    purpose: 'agent_turn',
    model: 'claude-fable-5-1',
    turn: 1,
    attempt: 1,
    status: 'ok',
    stopReason: 'tool_use',
    error: null,
    inputTokens: 1_000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 100,
    costUsd: 0.015,
    durationMs: 1_200,
    ...partial,
  }
}

describe('usage totals', () => {
  it('sums calls and keeps the cost unknown when one call has no price', () => {
    const t = totalsOf([
      call({ id: 'a', createdAt: '2026-09-27T09:00:00Z', cacheReadTokens: 500 }),
      call({ id: 'b', createdAt: '2026-09-27T09:01:00Z', costUsd: 0.01 }),
    ])
    expect(t).toMatchObject({
      calls: 2,
      inputTokens: 2_000,
      cacheReadTokens: 500,
      outputTokens: 200,
    })
    expect(t.costUsd).toBeCloseTo(0.025, 6)
    expect(cacheShare(t)).toBeCloseTo(500 / 2_500, 6)
    expect(totalsOf([call({ id: 'c', createdAt: 'x', costUsd: null })]).costUsd).toBeNull()
    expect(cacheShare(totalsOf([]))).toBeNull()
  })

  it('builds the ticket block newest first with per-purpose totals', () => {
    const u = ticketUsageFromRows(
      [
        call({ id: 'old', createdAt: '2026-09-27T08:00:00Z' }),
        call({
          id: 'check',
          createdAt: '2026-09-27T09:30:00Z',
          purpose: 'consistency_check',
          runId: null,
          model: 'claude-sonnet-5',
          costUsd: 0.004,
        }),
        call({ id: 'new', createdAt: '2026-09-27T09:00:00Z', turn: 2 }),
      ],
      [],
    )
    expect(u.calls.map((c) => c.id)).toEqual(['check', 'new', 'old'])
    expect(u.totals.calls).toBe(3)
    expect(u.byPurpose.agent_turn?.calls).toBe(2)
    expect(u.byPurpose.consistency_check?.costUsd).toBe(0.004)
  })
})

describe('window aggregation', () => {
  it('clamps the window and starts it at local midnight', () => {
    expect(usageWindow(undefined, now).days).toBe(30)
    expect(usageWindow('0', now).days).toBe(30)
    expect(usageWindow(9_999, now).days).toBe(365)
    const w = usageWindow(7, now)
    expect(w.days).toBe(7)
    expect(w.from.getHours()).toBe(0)
    expect(w.to).toBe(now)
    expect((now.getTime() - w.from.getTime()) / 86_400_000).toBeGreaterThan(6)
  })

  it('aggregates per day, purpose, model, tool and ticket inside the window only', () => {
    const w = usageWindow(3, now)
    const calls: ModelCallRow[] = [
      call({ id: 'a1', createdAt: '2026-09-26T09:00:00', ticketId: 'A', runId: 'rA' }),
      call({ id: 'a2', createdAt: '2026-09-26T09:01:00', ticketId: 'A', runId: 'rA', turn: 2 }),
      call({
        id: 'b1',
        createdAt: '2026-09-27T08:00:00',
        ticketId: 'B',
        runId: 'rB',
        model: 'claude-sonnet-5',
        purpose: 'consistency_check',
        costUsd: 0.004,
      }),
      call({ id: 'gone', createdAt: '2026-09-20T09:00:00', ticketId: 'C', runId: 'rC' }),
    ]
    const tools: ToolCallRow[] = [
      tool({
        id: 't1',
        modelCallId: 'a1',
        tool: 'stripe_events',
        contextTokens: 2_000,
        durationMs: 500,
      }),
      tool({
        id: 't2',
        modelCallId: 'a1',
        tool: 'stripe_events',
        contextTokens: 1_000,
        ok: false,
        durationMs: 300,
      }),
      tool({
        id: 't3',
        modelCallId: 'a2',
        tool: 'notion_page',
        contextTokens: null,
        resultChars: 400,
      }),
      tool({ id: 't4', modelCallId: 'gone', tool: 'notion_page', contextTokens: 9_999 }),
    ]
    const r = aggregateUsage(w, calls, tools, (id) =>
      id === 'A'
        ? { displayNumber: 4824, customerName: 'Tom', caseType: 'cancellation_only' }
        : null,
    )
    expect(r.totals.calls).toBe(3)
    expect(r.tickets).toBe(2)
    expect(r.runs).toBe(2)
    expect(r.series).toHaveLength(3)
    expect(r.series.map((d) => d.date)).toEqual(['2026-09-25', '2026-09-26', '2026-09-27'])
    expect(r.series[1]).toMatchObject({ calls: 2, tickets: 1, inputTokens: 2_000 })
    expect(r.series[2]).toMatchObject({ calls: 1, tickets: 1 })
    expect(r.byPurpose.agent_turn?.calls).toBe(2)
    expect(r.byPurpose.consistency_check?.calls).toBe(1)
    expect(r.byModel.map((m) => m.model)).toEqual(['claude-fable-5-1', 'claude-sonnet-5'])
    expect(r.tools).toEqual([
      {
        tool: 'stripe_events',
        calls: 2,
        failed: 1,
        contextTokens: 3_000,
        avgContextTokens: 1_500,
        avgDurationMs: 400,
      },
      {
        tool: 'notion_page',
        calls: 1,
        failed: 0,
        contextTokens: estimateContextTokens(400),
        avgContextTokens: estimateContextTokens(400),
        avgDurationMs: null,
      },
    ])
    expect(r.topTickets[0]).toMatchObject({
      ticketId: 'A',
      displayNumber: 4824,
      customerName: 'Tom',
      caseType: 'cancellation_only',
      runs: 1,
      calls: 2,
    })
    expect(r.topTickets[1]).toMatchObject({ ticketId: 'B', displayNumber: null })
    expect(r.topTickets).toHaveLength(2)
  })

  it('answers from the seed: every succeeded run has turns and tool calls, checks and KB drafts appear', () => {
    const seed = buildSeed(now)
    const detail = seedTicketDetail(seed, '4825')!
    expect(detail.usage?.calls.length).toBeGreaterThanOrEqual(3)
    expect(detail.usage?.toolCalls.map((t) => t.tool)).toContain('submit_proposal')
    // three seed turns on the agent model: 0.0359 + 0.01836 + 0.0324
    expect(detail.usage?.totals.costUsd).toBeCloseTo(0.08666, 4)
    expect(detail.runs[0]?.costUsd).toBeCloseTo(0.08666, 4)
    const r = seedUsageResponse(seed, usageWindow(30, now))
    expect(r.totals.calls).toBeGreaterThan(20)
    expect(r.byPurpose.consistency_check?.calls).toBeGreaterThan(0)
    expect(r.byPurpose.kb_condensation?.calls).toBeGreaterThan(0)
    expect(r.tools.find((t) => t.tool === 'stripe_events')?.calls).toBeGreaterThan(0)
    expect(r.topTickets[0]?.displayNumber).toBeTruthy()
    expect(r.series).toHaveLength(30)
  })
})

describe('row mappers', () => {
  it('turns pg rows (numeric as text, Date timestamps) into API rows', () => {
    const c = modelCallFromRow({
      id: 'x',
      ticket_id: 't',
      run_id: null,
      purpose: 'kb_condensation',
      model: 'claude-sonnet-5',
      turn: null,
      attempt: null,
      status: 'ok',
      stop_reason: 'end_turn',
      error: null,
      input_tokens: '1240',
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      output_tokens: 190,
      cost_usd: '0.004380',
      duration_ms: 3400,
      created_at: new Date('2026-09-27T10:00:00Z'),
    })
    expect(c).toMatchObject({
      inputTokens: 1240,
      costUsd: 0.00438,
      createdAt: '2026-09-27T10:00:00.000Z',
      runId: null,
      turn: null,
    })
    const t = toolCallFromRow({
      id: 'y',
      run_id: 'r',
      ticket_id: 't',
      model_call_id: 'x',
      turn: '2',
      tool: 'notion_page',
      source: 'kb',
      ok: true,
      input: { pageId: 'p' },
      result_chars: 3310,
      context_tokens: null,
      context_measured: false,
      duration_ms: null,
      created_at: '2026-09-27T10:00:01.000Z',
    })
    expect(t).toMatchObject({ turn: 2, contextTokens: null, contextMeasured: false, ok: true })
  })
})

describe('context attribution', () => {
  it('splits the measured growth by result size, remainder to the last tool, never negative', () => {
    expect(
      splitContextTokens(
        [
          { id: 'a', chars: 3_000 },
          { id: 'b', chars: 1_000 },
        ],
        1_001,
      ),
    ).toEqual([
      { id: 'a', contextTokens: 751 },
      { id: 'b', contextTokens: 250 },
    ])
    expect(splitContextTokens([{ id: 'a', chars: 0 }], 10)).toEqual([
      { id: 'a', contextTokens: 10 },
    ])
    expect(
      splitContextTokens(
        [
          { id: 'a', chars: 0 },
          { id: 'b', chars: 0 },
        ],
        3,
      ),
    ).toEqual([
      { id: 'a', contextTokens: 2 },
      { id: 'b', contextTokens: 1 },
    ])
  })
})

function tool(partial: Partial<ToolCallRow> & { id: string }): ToolCallRow {
  return {
    runId: 'r',
    ticketId: 't',
    modelCallId: null,
    turn: 1,
    tool: 'stripe_events',
    source: 'stripe',
    ok: true,
    input: {},
    resultChars: 1_000,
    contextTokens: 250,
    contextMeasured: true,
    durationMs: null,
    createdAt: '2026-09-26T09:00:30',
    ...partial,
  }
}
