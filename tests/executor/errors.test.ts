import { describe, expect, it } from 'vitest'
import {
  PreconditionError,
  ProviderError,
  formatActionError,
  fromLinearError,
  fromPgError,
  fromStripeError,
} from '../../server/executor/errors'
import {
  attemptKey,
  attemptOf,
  baseKeyOf,
  executionIdempotencyKey,
  manualIdempotencyKey,
  positionOf,
} from '../../server/executor/keys'
import { lineDiff, paramChanges, replyDiff } from '../../server/executor/diff'
import { formatMoney, isoDateFromUnix } from '../../server/executor/format'

describe('error formatting for the UI', () => {
  it('formats a Stripe rate limit like the design', () => {
    const err = new ProviderError('Stripe', '', {
      code: 'rate_limit',
      statusCode: 429,
      requestId: 'req_Qx91Lm',
      retryable: true,
    })
    const f = formatActionError(err, 'nothing was charged or refunded')
    expect(f.message).toBe(
      'Stripe: rate_limit (429) · nothing was charged or refunded · req_Qx91Lm',
    )
    expect(f.externalRefs).toEqual({ requestId: 'req_Qx91Lm', errorCode: 'rate_limit' })
    expect(f.retryable).toBe(true)
  })

  it('keeps the provider message when there is one', () => {
    const err = new ProviderError('Stripe', "No such subscription: 'sub_1'", {
      code: 'resource_missing',
      statusCode: 404,
      requestId: 'req_1',
    })
    expect(formatActionError(err, 'the subscription was not changed').message).toBe(
      "Stripe: resource_missing: No such subscription: 'sub_1' (404) · the subscription was not changed · req_1",
    )
  })

  it('formats preconditions and unknown errors in plain words, never with an em dash', () => {
    expect(
      formatActionError(new PreconditionError('Not the latest payment'), 'nothing was charged')
        .message,
    ).toBe('Not the latest payment · nothing was charged')
    const f = formatActionError(new Error('boom — really'), 'the reply was not sent')
    expect(f.message).toBe('Executor: boom · really · the reply was not sent')
    expect(f.message).not.toMatch(/[—―]/)
  })

  it('maps SDK errors to ProviderError', () => {
    const s = fromStripeError({
      type: 'StripeRateLimitError',
      code: 'rate_limit',
      statusCode: 429,
      requestId: 'req_x',
      message: 'Too many',
    })
    expect(s.provider).toBe('Stripe')
    expect(s.retryable).toBe(true)
    expect(s.requestId).toBe('req_x')
    const invalid = fromStripeError({
      type: 'StripeInvalidRequestError',
      code: 'resource_missing',
      statusCode: 404,
    })
    expect(invalid.retryable).toBe(false)
    const l = fromLinearError({ type: 'Ratelimited', status: 429, message: 'slow down' })
    expect(l.provider).toBe('Linear')
    expect(l.retryable).toBe(true)
    expect(l.code).toBe('Ratelimited')
    const p = fromPgError('Supabase', {
      code: '57014',
      message: 'canceling statement due to statement timeout',
    })
    expect(p.retryable).toBe(true)
    expect(formatActionError(p, 'the email was not stored').message).toBe(
      'Supabase: 57014: canceling statement due to statement timeout · the email was not stored',
    )
  })
})

describe('idempotency keys', () => {
  it('derives attempt keys and parses them back', () => {
    const base = executionIdempotencyKey('t1', 2, 1)
    expect(base).toBe('t1:v2:p1')
    expect(attemptKey(base, 1)).toBe(base)
    expect(attemptKey(base, 2)).toBe('t1:v2:p1:a2')
    expect(baseKeyOf('t1:v2:p1:a2')).toBe(base)
    expect(attemptOf('t1:v2:p1:a2')).toBe(2)
    expect(attemptOf(base)).toBe(1)
    expect(positionOf('t1:v2:p11:a3')).toBe(11)
    expect(positionOf(manualIdempotencyKey('t1', 'dec-1', 3))).toBe(3)
    expect(baseKeyOf(manualIdempotencyKey('t1', 'dec-1', 3))).toBe('t1:mdec-1:p3')
  })
})

describe('reply diff', () => {
  it('produces a line diff and counts', () => {
    const d = replyDiff(
      { subject: 'Re: A', body: 'Hi Tom,\n\nline two\n\nBye' },
      { subject: 'Re: A', body: 'Hi Tom,\n\nline 2 changed\n\nBye' },
    )!
    expect(d.subject).toBeNull()
    expect(d.added).toBe(1)
    expect(d.removed).toBe(1)
    expect(d.lines.filter((l) => l.op === 'keep')).toHaveLength(4)
    expect(lineDiff('a\nb', 'a\nb')).toEqual([
      { op: 'keep', text: 'a' },
      { op: 'keep', text: 'b' },
    ])
  })

  it('is null when nothing changed and records subject changes', () => {
    expect(replyDiff({ subject: 's', body: 'b' }, { subject: 's', body: 'b' })).toBeNull()
    expect(replyDiff({ subject: 's', body: 'b' }, { subject: 't', body: 'b' })?.subject).toEqual({
      from: 's',
      to: 't',
    })
  })

  it('lists param changes field by field', () => {
    expect(
      paramChanges(
        0,
        { amountCents: 1307, currency: 'usd' },
        { amountCents: 700, currency: 'usd' },
      ),
    ).toEqual([{ position: 0, field: 'params.amountCents', from: 1307, to: 700 }])
  })
})

describe('format helpers', () => {
  it('formats money and dates', () => {
    expect(formatMoney(1307)).toBe('$13.07')
    expect(formatMoney(799, 'eur')).toBe('€7.99')
    expect(formatMoney(500, 'chf')).toBe('5.00 CHF')
    expect(isoDateFromUnix(Date.UTC(2026, 9, 14) / 1000)).toBe('2026-10-14')
    expect(isoDateFromUnix(null)).toBeNull()
  })
})
