/**
 * A model that follows a script: each `create()` call returns the next turn, either tool calls or
 * plain text. Tests and the plumbing eval use it to drive the real loop, the real tools (fakes) and
 * the real validation without a network call.
 */
import type Anthropic from '@anthropic-ai/sdk'
import type { ModelClient, ModelRequest, ModelResponse } from './types'

export type ScriptedTurn =
  | { toolCalls: { name: string; input: unknown; id?: string }[] }
  | { text: string; stopReason?: 'end_turn' | 'refusal' | 'max_tokens' | 'pause_turn' }

export type ScriptFn = (request: ModelRequest, turn: number) => ScriptedTurn

export interface ScriptedModelClient extends ModelClient {
  readonly requests: ModelRequest[]
  /** Tool results the loop fed back, per turn, for assertions. */
  readonly toolResults: Anthropic.ToolResultBlockParam[][]
}

let counter = 0

export function createScriptedModelClient(script: ScriptedTurn[] | ScriptFn): ScriptedModelClient {
  const requests: ModelRequest[] = []
  const toolResults: Anthropic.ToolResultBlockParam[][] = []
  let turn = 0
  const next: ScriptFn =
    typeof script === 'function'
      ? script
      : (_req, i) => script[i] ?? { text: 'I have nothing more to add.' }
  return {
    kind: 'scripted',
    requests,
    toolResults,
    async create(params) {
      requests.push(params)
      // One entry per request, so toolResults[i] are the results the loop fed back before turn i.
      const last = params.messages[params.messages.length - 1]
      toolResults.push(
        last && last.role === 'user' && Array.isArray(last.content)
          ? last.content.filter(
              (b): b is Anthropic.ToolResultBlockParam =>
                typeof b === 'object' && b.type === 'tool_result',
            )
          : [],
      )
      const t = next(params, turn++)
      const content: Record<string, unknown>[] =
        'text' in t
          ? [{ type: 'text', text: t.text, citations: null }]
          : t.toolCalls.map((c) => ({
              type: 'tool_use',
              id: c.id ?? `toolu_scripted_${++counter}`,
              name: c.name,
              input: c.input as Record<string, unknown>,
            }))
      const message = {
        id: `msg_scripted_${++counter}`,
        type: 'message',
        role: 'assistant',
        model: params.model,
        content,
        stop_reason: 'text' in t ? (t.stopReason ?? 'end_turn') : 'tool_use',
        stop_sequence: null,
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }
      return message as unknown as ModelResponse
    },
  }
}
