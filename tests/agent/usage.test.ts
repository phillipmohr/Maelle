/**
 * Token usage recording (IRDR-460): one model_calls row per turn, one agent_tool_calls row per tool
 * call with its measured context share, run totals on success and failure, and the single calls
 * (consistency check, KB condensation) through the same sink.
 */
import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { consistencyCheck } from '../../server/agent/consistency'
import { createScriptedModelClient, type ScriptedTurn } from '../../server/agent/model/scripted'
import type { ModelClient } from '../../server/agent/model/types'
import { runAgent } from '../../server/agent/run'
import { SUBMIT_TOOL } from '../../server/agent/tools/definitions'
import { createAnthropicModelClient } from '../../server/learning/model-client'
import { createMemoryUsageSink } from '../../server/usage/memory'
import { trackModelCall } from '../../server/usage/record'
import { MODELS } from '../../shared/config'
import { costUsd } from '../../shared/pricing'
import { CASE_1_CANCELLATION } from '../../evals/fixtures/cases'
import { harnessDeps, runFixture, seedStore } from '../../evals/harness'

const good = CASE_1_CANCELLATION.scripted.proposal
const submit: ScriptedTurn = { toolCalls: [{ name: SUBMIT_TOOL, input: good }] }
const TICKET = '11111111-2222-4333-8444-555555555555'
/** What one scripted turn (1000 in, 200 out) costs on the agent model. */
const TURN_COST = costUsd(MODELS.agent, {
  inputTokens: 1000,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 200,
})!

/** The scripted client with growing input tokens, so the context measurement has something to see. */
function growingModel(turns: ScriptedTurn[], perTurn: number[]): ModelClient {
  const inner = createScriptedModelClient(turns)
  let i = 0
  return {
    kind: 'scripted',
    async create(params) {
      const r = await inner.create(params)
      const input = perTurn[i++] ?? 1000
      return { ...r, usage: { ...r.usage, input_tokens: input, cache_read_input_tokens: 500 } }
    },
  }
}

describe('agent run usage', () => {
  it('records one call per turn and one row per tool call, with the run and ticket ids', async () => {
    const r = await runFixture(CASE_1_CANCELLATION)
    expect(r.result.status).toBe('succeeded')
    const calls = r.usage.modelCalls
    expect(calls.length).toBe(r.store.runs.length > 0 ? calls.length : 0)
    expect(calls.length).toBeGreaterThanOrEqual(1)
    for (const [i, c] of calls.entries()) {
      expect(c).toMatchObject({
        purpose: 'agent_turn',
        runId: r.result.runId,
        ticketId: r.ticketId,
        turn: i + 1,
        attempt: 1,
        status: 'ok',
        model: MODELS.agent,
        inputTokens: 1000,
        outputTokens: 200,
      })
      expect(c.costUsd).toBeCloseTo(TURN_COST, 6)
      expect(c.durationMs).toBeGreaterThanOrEqual(0)
    }
    const tools = r.usage.toolCalls
    const submitRow = tools.find((t) => t.tool === SUBMIT_TOOL)!
    expect(submitRow).toMatchObject({ ok: true, source: null, runId: r.result.runId })
    expect(submitRow.modelCallId).toBe(calls.at(-1)!.id)
    expect(submitRow.resultChars).toBe('Proposal accepted.'.length)
    for (const t of tools.filter((t) => t.tool !== SUBMIT_TOOL)) {
      expect(t.source).not.toBeNull()
      expect(t.resultChars).toBeGreaterThan(0)
      expect(t.contextTokens).not.toBeNull()
    }
    // run totals: the loop's sums land on the run row
    const run = r.store.runs[0]!
    expect(run.inputTokens).toBe(1000 * calls.length)
    expect(run.outputTokens).toBe(200 * calls.length)
    expect(run.cacheReadTokens).toBe(0)
    expect(run.costUsd).toBeCloseTo(TURN_COST * calls.length, 6)
  })

  it('measures the context a tool result added from the next turn and splits it by size', async () => {
    const { store, ticketId } = seedStore(CASE_1_CANCELLATION)
    const model = growingModel(
      [
        {
          toolCalls: [
            { name: 'email_history', input: {} },
            { name: 'linear_search', input: { query: 'unsubscribe' } },
          ],
        },
        submit,
      ],
      [1000, 4200],
    )
    const deps = harnessDeps(CASE_1_CANCELLATION, store, { model })
    const result = await runAgent(deps, ticketId, 'new_ticket')
    expect(result.status).toBe('succeeded')
    const turn1 = deps.usage.toolCalls.filter((t) => t.turn === 1)
    expect(turn1).toHaveLength(2)
    // growth = (4200 + 500) - (1000 + 500) - 200 output = 3000, split by result characters
    expect(turn1.every((t) => t.contextMeasured)).toBe(true)
    expect(turn1.reduce((a, t) => a + (t.contextTokens ?? 0), 0)).toBe(3000)
    const [big, small] = [...turn1].sort((a, b) => b.resultChars - a.resultChars)
    expect(big!.contextTokens!).toBeGreaterThanOrEqual(small!.contextTokens!)
    expect(deps.usage.toolCalls.find((t) => t.tool === SUBMIT_TOOL)!.contextMeasured).toBe(false)
    expect(deps.usage.modelCalls[1]).toMatchObject({ inputTokens: 4200, cacheReadTokens: 500 })
    expect(store.runs[0]!.cacheReadTokens).toBe(1000)
  })

  it('keeps the tokens of a failed run and records the refusal', async () => {
    const { store, ticketId } = seedStore(CASE_1_CANCELLATION)
    const model = createScriptedModelClient([{ text: '', stopReason: 'refusal' }])
    const deps = harnessDeps(CASE_1_CANCELLATION, store, { model })
    const result = await runAgent(deps, ticketId, 'new_ticket')
    expect(result.status).toBe('failed')
    expect(deps.usage.modelCalls).toHaveLength(1)
    expect(deps.usage.modelCalls[0]).toMatchObject({ status: 'refusal', stopReason: 'refusal' })
    expect(store.runs[0]).toMatchObject({ status: 'failed', inputTokens: 1000, outputTokens: 200 })
    expect(store.runs[0]!.costUsd).toBeCloseTo(TURN_COST, 6)
  })

  it('records an API error as a zero-cost error row and lets the run fail as retryable', async () => {
    const { store, ticketId } = seedStore(CASE_1_CANCELLATION)
    const model: ModelClient = {
      kind: 'anthropic',
      async create() {
        throw new Error('overloaded_error: The API is overloaded')
      },
    }
    const deps = harnessDeps(CASE_1_CANCELLATION, store, { model })
    const result = await runAgent(deps, ticketId, 'new_ticket')
    expect(result).toMatchObject({ status: 'failed', retryable: true })
    expect(deps.usage.modelCalls[0]).toMatchObject({
      status: 'error',
      costUsd: 0,
      inputTokens: 0,
      error: expect.stringMatching(/overloaded/),
    })
    expect(store.runs[0]!.inputTokens).toBeNull()
  })

  it('never fails the call when the sink throws', async () => {
    const model = createScriptedModelClient([{ text: 'hi' }])
    const sink = {
      kind: 'memory' as const,
      async recordModelCall() {
        throw new Error('db down')
      },
      async recordToolCalls() {},
      async setToolContextTokens() {},
    }
    const logged: string[] = []
    const res = await trackModelCall(
      sink,
      { purpose: 'eval', model: 'claude-fable-5-1' },
      () => model.create({ model: 'claude-fable-5-1', max_tokens: 10, messages: [] }),
      (m) => logged.push(m),
    )
    expect(res.stop_reason).toBe('end_turn')
    expect(logged[0]).toMatch(/not recorded/)
  })
})

describe('single calls', () => {
  it('the consistency check records one row with the ticket uuid', async () => {
    const usage = createMemoryUsageSink()
    const model = createScriptedModelClient([
      { toolCalls: [{ name: 'report_mismatches', input: { mismatches: [] } }] },
    ])
    const res = await consistencyCheck(
      { ticketId: TICKET, replyBody: 'All good.', enabledActions: [] },
      { model, modelId: 'claude-sonnet-5', usage },
    )
    expect(res.mismatches).toEqual([])
    expect(usage.modelCalls).toHaveLength(1)
    expect(usage.modelCalls[0]).toMatchObject({
      purpose: 'consistency_check',
      ticketId: TICKET,
      runId: null,
      model: 'claude-sonnet-5',
      inputTokens: 1000,
      outputTokens: 200,
    })
    expect(usage.modelCalls[0]!.costUsd).toBeCloseTo(0.004, 6)
    // a display number is not a uuid: the row has no ticket
    await consistencyCheck(
      { ticketId: '4824', replyBody: 'All good.', enabledActions: [] },
      {
        model: createScriptedModelClient([
          { toolCalls: [{ name: 'report_mismatches', input: { mismatches: [] } }] },
        ]),
        modelId: 'claude-sonnet-5',
        usage,
      },
    )
    expect(usage.modelCalls[1]!.ticketId).toBeNull()
  })

  it('the KB condensation records one row through the learning client', async () => {
    const usage = createMemoryUsageSink()
    const fake = {
      messages: {
        async create() {
          return {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-5',
            stop_reason: 'end_turn',
            stop_sequence: null,
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  name: 'Follower counts update once a day',
                  category: 'Data & accuracy',
                  type: 'Explanation',
                  customerPhrasing: 'The follower count keeps going up but nothing new shows up.',
                  shortAnswer:
                    'Counts refresh once a day, so a jump can show before the new followers do.',
                }),
              },
            ],
            usage: { input_tokens: 1240, output_tokens: 190 },
          } as unknown as Anthropic.Message
        },
      },
    } as unknown as Pick<Anthropic, 'messages'>
    const client = createAnthropicModelClient({ apiKey: 'sk-test', client: fake, usage })
    const out = await client.condenseKnowledge({
      ticketId: TICKET,
      subject: 'Follower count',
      caseLabel: 'Data accuracy',
      customerMessage: 'The follower count keeps going up but nothing new shows up.',
      reply: 'Counts refresh once a day.',
      suggestedCategory: 'Data & accuracy',
      suggestedType: 'Explanation',
    })
    expect(out.name).toBe('Follower counts update once a day')
    expect(usage.modelCalls).toHaveLength(1)
    expect(usage.modelCalls[0]).toMatchObject({
      purpose: 'kb_condensation',
      ticketId: TICKET,
      model: 'claude-sonnet-5',
      inputTokens: 1240,
      outputTokens: 190,
      status: 'ok',
    })
    expect(usage.modelCalls[0]!.costUsd).toBeCloseTo(0.00438, 6)
  })
})
