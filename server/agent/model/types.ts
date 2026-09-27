/**
 * The model boundary: one `messages.create`-with-tools call. The Anthropic adapter wraps the SDK,
 * the scripted client replays predetermined tool calls for tests and the plumbing eval. Both use
 * the SDK's own types so the loop code is identical.
 */
import type Anthropic from '@anthropic-ai/sdk'

export type ModelRequest = Anthropic.MessageCreateParamsNonStreaming
export type ModelResponse = Anthropic.Message

export interface ModelClient {
  readonly kind: 'anthropic' | 'scripted' | 'unavailable'
  create(params: ModelRequest): Promise<ModelResponse>
}

/** Used when ANTHROPIC_API_KEY is missing: every run fails fast with a clear error. */
export function createUnavailableModelClient(reason = 'ANTHROPIC_API_KEY is not set'): ModelClient {
  return {
    kind: 'unavailable',
    async create() {
      throw new Error(`Model unavailable: ${reason}`)
    },
  }
}
