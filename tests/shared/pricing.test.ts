import { describe, expect, it } from 'vitest'
import {
  addCost,
  addUsage,
  contextTokens,
  costUsd,
  MODEL_PRICING,
  priceFor,
  usageFromApi,
  ZERO_USAGE,
} from '../../shared/pricing'

describe('pricing', () => {
  it('prices the four token kinds at the model rates', () => {
    // Fable 5.1: $10 in, $12.50 cache write, $0.25 cache read, $50 out per MTok
    const c = costUsd('claude-fable-5-1', {
      inputTokens: 4_150,
      cacheCreationTokens: 9_600,
      cacheReadTokens: 0,
      outputTokens: 360,
    })
    expect(c).toBeCloseTo(0.1795, 6)
    expect(
      costUsd('claude-sonnet-5', {
        inputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(2)
    expect(costUsd('claude-fable-5-1', ZERO_USAGE)).toBe(0)
  })

  it('matches dated snapshots by prefix and returns null for unknown models', () => {
    expect(priceFor('claude-sonnet-5-20260401')).toEqual(priceFor('claude-sonnet-5'))
    // the longest known id wins: a dated Sonnet 5.5 is not priced as Sonnet 5
    expect(priceFor('claude-sonnet-5-5-20260901')).toBe(MODEL_PRICING['claude-sonnet-5-5'])
    expect(priceFor('claude-sonnet-5-20260401')).toBe(MODEL_PRICING['claude-sonnet-5'])
    expect(priceFor('gpt-oh-no')).toBeNull()
    expect(costUsd('gpt-oh-no', { ...ZERO_USAGE, inputTokens: 10 })).toBeNull()
    expect(priceFor(null)).toBeNull()
  })

  it('keeps an unknown cost unknown when summing', () => {
    expect(addCost(0.1, 0.2)).toBeCloseTo(0.3, 6)
    expect(addCost(0.1, null)).toBeNull()
    expect(addCost(null, 0)).toBeNull()
  })

  it('reads the SDK usage object with missing fields as zero', () => {
    expect(usageFromApi({ input_tokens: 10, output_tokens: 2 })).toEqual({
      inputTokens: 10,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 2,
    })
    expect(usageFromApi(null)).toEqual(ZERO_USAGE)
    const u = addUsage(
      { inputTokens: 1, cacheReadTokens: 2, cacheCreationTokens: 3, outputTokens: 4 },
      { inputTokens: 10, cacheReadTokens: 20, cacheCreationTokens: 30, outputTokens: 40 },
    )
    expect(u).toEqual({
      inputTokens: 11,
      cacheReadTokens: 22,
      cacheCreationTokens: 33,
      outputTokens: 44,
    })
    expect(contextTokens(u)).toBe(66)
  })
})
