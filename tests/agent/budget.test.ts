/**
 * Cost controls of the agent loop (IRDR-463): explicit effort, conversation caching, the research
 * nudge from `researchNudgeTurn` on, and smaller tool results.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { researchNudge, runToolLoop } from '../../server/agent/loop'
import { createScriptedModelClient, type ScriptedTurn } from '../../server/agent/model/scripted'
import type { ModelClient } from '../../server/agent/model/types'
import { runAgent } from '../../server/agent/run'
import { compactJson, MAX_RESULT_CHARS, SUBMIT_TOOL } from '../../server/agent/tools/definitions'
import { createFakeTools } from '../../server/agent/tools'
import { CASE_1_CANCELLATION } from '../../evals/fixtures/cases'
import { harnessDeps, seedStore } from '../../evals/harness'

const good = CASE_1_CANCELLATION.scripted.proposal
const submit: ScriptedTurn = { toolCalls: [{ name: SUBMIT_TOOL, input: good }] }
const research: ScriptedTurn = { toolCalls: [{ name: 'email_history', input: {} }] }

/** The scripted client keeps a reference to the loop's (mutating) messages array, so snapshot each request. */
function snapshotting(turns: ScriptedTurn[]) {
  const inner = createScriptedModelClient(turns)
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = []
  const model: ModelClient = {
    kind: 'scripted',
    async create(params) {
      requests.push({ ...params, messages: structuredClone(params.messages) })
      return inner.create(params)
    },
  }
  return { model, requests }
}

function lastUserText(req: Anthropic.MessageCreateParamsNonStreaming): string[] {
  const last = req.messages[req.messages.length - 1]
  if (!last || last.role !== 'user' || !Array.isArray(last.content)) return []
  return last.content
    .filter((b): b is Anthropic.TextBlockParam => typeof b === 'object' && b.type === 'text')
    .map((b) => b.text)
}

describe('agent loop cost controls', () => {
  it('sets the configured effort and caches the whole conversation on every request', async () => {
    const { store, ticketId } = seedStore(CASE_1_CANCELLATION)
    const model = createScriptedModelClient([research, submit])
    const deps = harnessDeps(CASE_1_CANCELLATION, store, { model })
    const result = await runAgent(deps, ticketId, 'new_ticket')
    expect(result.status).toBe('succeeded')
    expect(model.requests).toHaveLength(2)
    for (const req of model.requests) {
      expect(req.output_config?.effort).toBe('high')
      expect(req.cache_control).toEqual({ type: 'ephemeral' })
      expect(req.tool_choice).toEqual({ type: 'auto' })
      const system = req.system as Anthropic.TextBlockParam[]
      expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' })
    }
  })

  it('appends the research nudge to the tool results from researchNudgeTurn on', async () => {
    const { store, ticketId } = seedStore(CASE_1_CANCELLATION)
    const { model, requests } = snapshotting([research, research, research, submit])
    const deps = harnessDeps(CASE_1_CANCELLATION, store, {
      model,
      config: { researchNudgeTurn: 2, maxIterations: 6 },
    })
    const result = await runAgent(deps, ticketId, 'new_ticket')
    expect(result.status).toBe('succeeded')
    // requests[i] carries the results of turn i; the nudge starts with the results of turn 2
    expect(lastUserText(requests[1]!)).toEqual([])
    expect(lastUserText(requests[2]!)).toEqual([researchNudge(2, 6)])
    expect(lastUserText(requests[3]!)).toEqual([researchNudge(3, 6)])
    expect(researchNudge(2, 6)).toMatch(/research turn 2 of at most 6/)
    // tool_result blocks stay first, as the API requires
    const last = requests[2]!.messages.at(-1)!.content as Anthropic.ContentBlockParam[]
    expect(last[0]!.type).toBe('tool_result')
  })

  it('does not nudge when disabled or before the turn, and never after an accepted proposal', async () => {
    const tools = createFakeTools(CASE_1_CANCELLATION.tools)
    const { model, requests } = snapshotting([research, research, submit])
    const result = await runToolLoop({
      model,
      modelId: 'claude-sonnet-5-5',
      maxIterations: 5,
      system: 'system',
      userMessage: 'user',
      tools: [],
      toolContext: { tools, now: new Date(), emailHistory: async () => [] },
      finalize: async () => ({
        ok: true,
        proposal: {} as never,
        translations: [],
        notes: [],
      }),
      researchNudgeTurn: null,
    })
    expect(result.usage.turns).toBe(3)
    for (const req of requests) expect(lastUserText(req)).toEqual([])
    expect(requests[0]!.output_config).toBeUndefined()
  })

  it('keeps tool results small', () => {
    expect(MAX_RESULT_CHARS).toBe(12_000)
    const big = compactJson({ rows: Array.from({ length: 2000 }, (_, i) => `row-${i}-xxxxxxxx`) })
    expect(big.length).toBeLessThan(MAX_RESULT_CHARS + 120)
    expect(big).toMatch(/truncated .* Narrow the query/)
    expect(compactJson({ a: 1 })).toBe('{"a":1}')
  })
})
