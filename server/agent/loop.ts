/**
 * The Claude tool-use loop: system prompt + user message, research tools, one `submit_proposal`.
 * Validation issues go back to the model as tool errors; after three rejected submissions (or three
 * turns without a submission) the run fails with a readable error.
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { Proposal } from '#shared/proposal'
import type { ModelClient } from './model/types'
import {
  SUBMIT_TOOL,
  executeResearchTool,
  type ToolContext,
  type Translation,
} from './tools/definitions'
import type { FinalizeResult } from './finalize'
import type { ProgressSource } from './types'

export const MAX_SUBMISSION_FAILURES = 3

export class AgentLoopError extends Error {
  readonly issues: string[]
  constructor(message: string, issues: string[] = []) {
    super(message)
    this.name = 'AgentLoopError'
    this.issues = issues
  }
}

export interface LoopUsage {
  inputTokens: number
  outputTokens: number
  turns: number
  toolCalls: number
  submissions: number
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
  log?: (msg: string, data?: unknown) => void
}

export interface LoopResult {
  proposal: Proposal
  translations: Translation[]
  notes: string[]
  usage: LoopUsage
  rejectedSubmissions: string[][]
}

export async function runToolLoop(args: LoopArgs): Promise<LoopResult> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: args.userMessage }]
  const usage: LoopUsage = {
    inputTokens: 0,
    outputTokens: 0,
    turns: 0,
    toolCalls: 0,
    submissions: 0,
  }
  const rejected: string[][] = []
  let failures = 0
  let truncations = 0

  for (let i = 0; i < args.maxIterations; i++) {
    const response = await args.model.create({
      model: args.modelId,
      max_tokens: 16_000,
      system: [{ type: 'text', text: args.system, cache_control: { type: 'ephemeral' } }],
      tools: args.tools,
      tool_choice: { type: 'auto' },
      messages,
    })
    usage.turns++
    usage.inputTokens +=
      (response.usage?.input_tokens ?? 0) +
      (response.usage?.cache_read_input_tokens ?? 0) +
      (response.usage?.cache_creation_input_tokens ?? 0)
    usage.outputTokens += response.usage?.output_tokens ?? 0
    args.log?.(`turn ${i + 1}: stop_reason=${response.stop_reason}`)

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
    let final: LoopResult | null = null
    for (const use of toolUses) {
      usage.toolCalls++
      if (use.name === SUBMIT_TOOL) {
        usage.submissions++
        const outcome = await args.finalize(use.input)
        if (outcome.ok) {
          final = {
            proposal: outcome.proposal,
            translations: outcome.translations,
            notes: outcome.notes,
            usage,
            rejectedSubmissions: rejected,
          }
          results.push({ type: 'tool_result', tool_use_id: use.id, content: 'Proposal accepted.' })
        } else {
          failures++
          rejected.push(outcome.issues)
          args.log?.(`submission rejected (${failures}/${MAX_SUBMISSION_FAILURES})`, outcome.issues)
          if (failures >= MAX_SUBMISSION_FAILURES)
            throw new AgentLoopError(
              `Proposal rejected ${MAX_SUBMISSION_FAILURES} times. Last issues: ${outcome.issues.join(' | ')}`,
              outcome.issues,
            )
          results.push({
            type: 'tool_result',
            tool_use_id: use.id,
            is_error: true,
            content: `The proposal was rejected (attempt ${failures} of ${MAX_SUBMISSION_FAILURES}). Fix every issue and call submit_proposal again with the COMPLETE proposal:\n- ${outcome.issues.join('\n- ')}`,
          })
        }
        continue
      }
      const outcome = await executeResearchTool(use.name, use.input, args.toolContext)
      if (outcome.source) await args.onToolOutcome?.(outcome.source, !outcome.isError)
      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: outcome.content,
        ...(outcome.isError ? { is_error: true } : {}),
      })
    }
    messages.push({ role: 'user', content: results })
    if (final) return final
  }
  throw new AgentLoopError(
    `The model did not submit a valid proposal within ${args.maxIterations} steps.`,
    rejected.flat(),
  )
}
