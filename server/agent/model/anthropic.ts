/**
 * Anthropic SDK adapter. Constructed only when ANTHROPIC_API_KEY is set. Streams under the hood
 * (`messages.stream(...).finalMessage()`) so long Fable turns never hit the HTTP timeout, and returns
 * the complete `Message` to the loop. Thinking stays at the model default (always on for Fable),
 * so no `thinking` parameter is sent.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { ModelClient, ModelRequest, ModelResponse } from './types'

export function createAnthropicModelClient(apiKey: string): ModelClient {
  const client = new Anthropic({ apiKey, maxRetries: 3, timeout: 15 * 60_000 })
  return {
    kind: 'anthropic',
    async create(params: ModelRequest): Promise<ModelResponse> {
      const { stream: _stream, ...rest } = params as ModelRequest & { stream?: boolean }
      const stream = client.messages.stream(rest)
      return stream.finalMessage()
    },
  }
}
