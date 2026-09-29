/**
 * Anthropic SDK adapter. Constructed only when ANTHROPIC_API_KEY is set. Streams under the hood
 * (`messages.stream(...).finalMessage()`) so long turns never hit the HTTP timeout, and returns the
 * complete `Message` to the loop. Thinking stays at the model default (adaptive); the callers set
 * `output_config.effort` instead of a `thinking` parameter.
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
