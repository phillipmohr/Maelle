/**
 * The Claude tool-use loop: system prompt + user message, research tools, one `submit_proposal`.
 * Validation issues go back to the model as tool errors; after three rejected submissions (or three
 * turns without a submission) the run fails with a readable error.
 *
 * Cost (IRDR-463): `output_config.effort` is set explicitly (the model default would be high), the
 * whole conversation is cached with the top-level `cache_control` (every turn reads the previous
 * turns from the cache; the system prompt keeps its own breakpoint so it also hits across runs),
 * and from `researchNudgeTurn` on the tool results carry a nudge to submit with what is known.
 *
 * Usage: every turn is one `model_calls` row and every tool call one `agent_tool_calls` row
 * (through the usage sink, IRDR-460). The context a tool result adds is measured on the next turn:
 * the growth of the input tokens minus the previous output, split by result size when several
 * tools ran in one turn. `onTurn` reports the running totals so the run can persist them even when
 * the loop fails later.
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { Effort } from '#shared/config'
import type { Proposal } from '#shared/proposal'
import { addCost, contextTokens, costUsd, type TokenUsage } from '#shared/pricing'
import { estimateContextTokens } from '#shared/usage'
import type { ModelClient } from './model/types'
import {
  SUBMIT_TOOL,
  executeResearchTool,
  type ToolContext,
  type Translation,
} from './tools/definitions'
import type { FinalizeResult } from './finalize'
import type { ProgressSource } from './types'
import { newCallId, trackModelCall } from '../usage/record'
import type { ToolCallRecord, UsageSink } from '../usage/types'

export const MAX_SUBMISSION_FAILURES = 3

/** Appended to the tool results from `researchNudgeTurn` on. */
export function researchNudge(turn: number, maxIterations: number): string {
  return `Research budget: this was research turn ${turn} of at most ${maxIterations}. Call submit_proposal now with what you know. Only if one specific fact that an action or the reply needs is still missing, fetch exactly that in a single turn and then submit.`
}

export class AgentLoopError extends Error {
  readonly issues: string[]
  constructor(message: string, issues: string[] = []) {
    super(message)
    this.name = 'AgentLoopError'
    this.issues = issues
  }
}

export interface LoopUsage extends TokenUsage {
  /** Null when a turn ran on a model without a known price. */
  costUsd: number | null
  turns: number
  toolCalls: number
  submissions: number
}

export interface LoopCallMeta {
  ticketId: string | null
  runId: string | null
  attempt: number | null
}

export interface LoopArgs {
  model: ModelClient
  modelId: string
  maxIterations: number
  system: string
  userMessage: string
  tools: Anthropic.Tool[]
  toolContext: ToolContext
  finalize: (input: unknown) => Promise<FinalizeResult>
  onToolOutcome?: (source: ProgressSource, ok: boolean) => Promise<void> | void
  /** Running totals after every turn (the run persists them on success and on failure). */
  onTurn?: (usage: LoopUsage) => void
  /** Where the per-call and per-tool rows go; null records nothing. */
  usage?: UsageSink | null
  callMeta?: LoopCallMeta
  /** Thinking depth (`output_config.effort`); omitted means the model default. */
  effort?: Effort
  /** First turn whose tool results carry the research nudge; null or 0 disables it. */
  researchNudgeTurn?: number | null
  log?: (msg: string, data?: unknown) => void
}

export interface LoopResult {
  proposal: Proposal
  translations: Translation[]
  notes: string[]
  usage: LoopUsage
  rejectedSubmissions: string[][]
}

export function emptyLoopUsage(): LoopUsage {
  return {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    turns: 0,
    toolCalls: 0,
    submissions: 0,
  }
}

interface PendingTools {
  /** Tool calls of the previous turn whose context share is still unmeasured. */
  rows: { id: string; chars: number }[]
  /** Context and output of the turn that asked for them. */
  context: number
  output: number
}

/** Splits the measured context growth over the previous turn's tool results by result size. */
export function splitContextTokens(
  rows: readonly { id: string; chars: number }[],
  delta: number,
): { id: string; contextTokens: number }[] {
  const totalChars = rows.reduce((a, r) => a + r.chars, 0)
  let assigned = 0
  return rows.map((r, i) => {
    const last = i === rows.length - 1
    const share = last
      ? delta - assigned
      : totalChars > 0
        ? Math.round((delta * r.chars) / totalChars)
        : Math.round(delta / rows.length)
    assigned += share
    return { id: r.id, contextTokens: Math.max(0, share) }
  })
}

export async function runToolLoop(args: LoopArgs): Promise<LoopResult> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: args.userMessage }]
  const usage = emptyLoopUsage()
  const rejected: string[][] = []
  const sink = args.usage ?? null
  const meta = args.callMeta ?? { ticketId: null, runId: null, attempt: null }
  let failures = 0
  let truncations = 0
  let pending: PendingTools | null = null

  const recordTools = async (rows: ToolCallRecord[]) => {
    if (!sink || rows.length === 0) return
    try {
      await sink.recordToolCalls(rows)
    } catch (e) {
      args.log?.('usage: tool calls not recorded', e)
    }
  }
  const measureContext = async (turnUsage: TokenUsage) => {
    if (!pending) return
    const delta = contextTokens(turnUsage) - pending.context - pending.output
    if (delta > 0 && sink) {
      try {
        await sink.setToolContextTokens(splitContextTokens(pending.rows, delta))
      } catch (e) {
        args.log?.('usage: context tokens not recorded', e)
      }
    }
    pending = null
  }

  for (let i = 0; i < args.maxIterations; i++) {
    const turn = i + 1
    const callId = newCallId()
    const response = await trackModelCall(
      sink,
      {
        id: callId,
        purpose: 'agent_turn',
        model: args.modelId,
        ticketId: meta.ticketId,
        runId: meta.runId,
        turn,
        attempt: meta.attempt,
      },
      () =>
        args.model.create({
          model: args.modelId,
          max_tokens: 16_000,
          // Automatic caching of the conversation prefix: each turn reads the earlier turns from
          // the cache; the explicit breakpoint keeps the system prompt cached across runs too.
          cache_control: { type: 'ephemeral' },
          system: [{ type: 'text', text: args.system, cache_control: { type: 'ephemeral' } }],
          tools: args.tools,
          tool_choice: { type: 'auto' },
          ...(args.effort ? { output_config: { effort: args.effort } } : {}),
          messages,
        }),
      args.log,
    )
    const turnUsage: TokenUsage = {
      inputTokens: response.usage?.input_tokens ?? 0,
      cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: response.usage?.cache_creation_input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    }
    usage.turns++
    usage.inputTokens += turnUsage.inputTokens
    usage.cacheReadTokens += turnUsage.cacheReadTokens
    usage.cacheCreationTokens += turnUsage.cacheCreationTokens
    usage.outputTokens += turnUsage.outputTokens
    usage.costUsd = addCost(usage.costUsd, costUsd(response.model || args.modelId, turnUsage))
    args.onTurn?.({ ...usage })
    await measureContext(turnUsage)
    args.log?.(`turn ${turn}: stop_reason=${response.stop_reason}`)

    if (response.stop_reason === 'refusal') {
      throw new AgentLoopError(
        'The model declined to work on this ticket (refusal). Handle it manually or re-run.',
      )
    }
    messages.push({ role: 'assistant', content: response.content })

    if (response.stop_reason === 'max_tokens') {
      if (++truncations > 2)
        throw new AgentLoopError('The model response was cut off three times (max_tokens).')
      messages.push({
        role: 'user',
        content:
          'Your response was cut off. Continue, keep the research short, and call submit_proposal with the complete proposal.',
      })
      continue
    }
    if (response.stop_reason === 'pause_turn') continue

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )
    if (toolUses.length === 0) {
      failures++
      if (failures >= MAX_SUBMISSION_FAILURES)
        throw new AgentLoopError(
          `The model ended ${MAX_SUBMISSION_FAILURES} turns without calling submit_proposal.`,
          rejected.flat(),
        )
      messages.push({
        role: 'user',
        content:
          'Plain text is not an output. Call the submit_proposal tool now with the complete proposal (case, risk, research, actions, reply, knowledgeRefs, translations).',
      })
      continue
    }

    const results: Anthropic.ToolResultBlockParam[] = []
    const toolRows: ToolCallRecord[] = []
    let final: LoopResult | null = null
    for (const use of toolUses) {
      usage.toolCalls++
      const started = Date.now()
      const input =
        use.input && typeof use.input === 'object' ? (use.input as Record<string, unknown>) : {}
      if (use.name === SUBMIT_TOOL) {
        usage.submissions++
        const outcome = await args.finalize(use.input)
        let content: string
        if (outcome.ok) {
          final = {
            proposal: outcome.proposal,
            translations: outcome.translations,
            notes: outcome.notes,
            usage,
            rejectedSubmissions: rejected,
          }
          content = 'Proposal accepted.'
          results.push({ type: 'tool_result', tool_use_id: use.id, content })
        } else {
          failures++
          rejected.push(outcome.issues)
          args.log?.(`submission rejected (${failures}/${MAX_SUBMISSION_FAILURES})`, outcome.issues)
          content = `The proposal was rejected (attempt ${failures} of ${MAX_SUBMISSION_FAILURES}). Fix every issue and call submit_proposal again with the COMPLETE proposal:\n- ${outcome.issues.join('\n- ')}`
          if (failures >= MAX_SUBMISSION_FAILURES) {
            toolRows.push(
              toolRow(callId, meta, turn, use.name, null, false, input, content, started),
            )
            await recordTools(toolRows)
            throw new AgentLoopError(
              `Proposal rejected ${MAX_SUBMISSION_FAILURES} times. Last issues: ${outcome.issues.join(' | ')}`,
              outcome.issues,
            )
          }
          results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content })
        }
        toolRows.push(
          toolRow(callId, meta, turn, use.name, null, outcome.ok, input, content, started),
        )
        continue
      }
      const outcome = await executeResearchTool(use.name, use.input, args.toolContext)
      if (outcome.source) await args.onToolOutcome?.(outcome.source, !outcome.isError)
      toolRows.push(
        toolRow(
          callId,
          meta,
          turn,
          use.name,
          outcome.source,
          !outcome.isError,
          input,
          outcome.content,
          started,
        ),
      )
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: outcome.content,
        ...(outcome.isError ? { is_error: true } : {}),
      })
    }
    await recordTools(toolRows)
    const nudge =
      !final && args.researchNudgeTurn && turn >= args.researchNudgeTurn
        ? [{ type: 'text' as const, text: researchNudge(turn, args.maxIterations) }]
        : []
    messages.push({ role: 'user', content: [...results, ...nudge] })
    if (final) return final
    // The results just pushed are read by the next turn; its input growth measures their size.
    pending = {
      rows: toolRows.map((r) => ({ id: r.id, chars: r.resultChars })),
      context: contextTokens(turnUsage),
      output: turnUsage.outputTokens,
    }
  }
  throw new AgentLoopError(
    `The model did not submit a valid proposal within ${args.maxIterations} steps.`,
    rejected.flat(),
  )
}

function toolRow(
  modelCallId: string,
  meta: LoopCallMeta,
  turn: number,
  tool: string,
  source: ProgressSource | null,
  ok: boolean,
  input: Record<string, unknown>,
  content: string,
  started: number,
): ToolCallRecord {
  return {
    id: newCallId(),
    runId: meta.runId,
    ticketId: meta.ticketId,
    modelCallId,
    turn,
    tool,
    source,
    ok,
    input,
    resultChars: content.length,
    contextTokens: estimateContextTokens(content.length),
    contextMeasured: false,
    durationMs: Date.now() - started,
  }
}
