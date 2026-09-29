/**
 * Claude prices in USD per million tokens, from platform.claude.com/docs/en/about-claude/pricing
 * (checked 2026-09-29). A call is priced when it is recorded (`model_calls.cost_usd`), so a later
 * price change never rewrites the history. An unknown model costs `null`; the UI then shows tokens
 * only. Update this table when Anthropic changes a price or Maelle switches models.
 */

export interface ModelPrice {
  /** Uncached input tokens. */
  input: number
  output: number
  /** Cache hits and refreshes. */
  cacheRead: number
  /** 5-minute cache writes (the only cache TTL Maelle uses). */
  cacheWrite: number
}

export const MODEL_PRICING: Readonly<Record<string, ModelPrice>> = {
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  'claude-fable-5': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-7': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
}

/** The four token kinds of one or more calls, as the API reports them. */
export interface TokenUsage {
  inputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  outputTokens: number
}

export const ZERO_USAGE: Readonly<TokenUsage> = {
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
}

/**
 * The price of a model id. Exact match first; otherwise the longest known id that prefixes it, so a
 * dated snapshot such as `claude-sonnet-5-20260401` is priced like `claude-sonnet-5`.
 */
export function priceFor(model: string | null | undefined): ModelPrice | null {
  if (!model) return null
  const exact = MODEL_PRICING[model]
  if (exact) return exact
  let best: string | null = null
  for (const id of Object.keys(MODEL_PRICING)) {
    if (model.startsWith(`${id}-`) && (!best || id.length > best.length)) best = id
  }
  return best ? MODEL_PRICING[best]! : null
}

/** Cost of one call in USD (six decimals), or null when the model has no known price. */
export function costUsd(model: string | null | undefined, usage: TokenUsage): number | null {
  const p = priceFor(model)
  if (!p) return null
  const usd =
    (usage.inputTokens * p.input +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheCreationTokens * p.cacheWrite +
      usage.outputTokens * p.output) /
    1_000_000
  return Math.round(usd * 1_000_000) / 1_000_000
}

/** `response.usage` of the Anthropic SDK → the four token kinds (missing fields count as 0). */
export function usageFromApi(
  u:
    | {
        input_tokens?: number | null
        output_tokens?: number | null
        cache_read_input_tokens?: number | null
        cache_creation_input_tokens?: number | null
      }
    | null
    | undefined,
): TokenUsage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u?.cache_creation_input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
  }
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  }
}

/** Sum of two costs where `null` means "unknown": unknown + anything stays unknown. */
export function addCost(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null
  return Math.round((a + b) * 1_000_000) / 1_000_000
}

/** Everything the model read: uncached input plus both cache kinds. */
export function contextTokens(u: TokenUsage): number {
  return u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens
}
