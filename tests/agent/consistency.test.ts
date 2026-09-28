import { describe, expect, it } from 'vitest'
import { consistencyCheck, ruleBasedConsistencyCheck } from '../../server/agent/consistency'
import { createScriptedModelClient } from '../../server/agent/model/scripted'
import { createUnavailableModelClient } from '../../server/agent/model/types'

const refund = { type: 'refund_latest_payment' as const, params: { amountCents: 1307 } }
const send = { type: 'send_reply' as const, params: { to: 'a@b.co' } }

describe('rule-based consistency check', () => {
  it('flags a promised refund without the action, and a refund action the reply hides', () => {
    const a = ruleBasedConsistencyCheck({
      ticketId: 't',
      replyBody: "I've refunded your $13.07 payment.",
      enabledActions: [send],
    })
    expect(a.map((m) => m.text)).toContain(
      'The reply mentions a refund but the matching action is off.',
    )
    expect(a[0]!.severity).toBe('error')
    const b = ruleBasedConsistencyCheck({
      ticketId: 't',
      replyBody: 'Thanks for reaching out, all good.',
      enabledActions: [refund, send],
    })
    expect(b.map((m) => m.text)).toContain(
      'Refund latest payment will run but the reply does not mention it.',
    )
  })

  it('checks release notices, linear tickets, removals, deletions and retries', () => {
    const texts = (
      body: string,
      actions: { type: never; params: Record<string, unknown> }[] = [],
    ) =>
      ruleBasedConsistencyCheck({
        ticketId: 't',
        replyBody: body,
        enabledActions: actions as never,
      }).map((m) => m.text)
    expect(texts("I'll let you know personally as soon as it's live.")).toContain(
      'The reply mentions a release notice but the matching action is off.',
    )
    expect(texts("I've passed it to our engineering team.")).toContain(
      'The reply mentions a Linear ticket but the matching action is off.',
    )
    expect(texts("I've removed your profile from InstaRadar.")).toContain(
      'The reply mentions a removal from tracking but the matching action is off.',
    )
    expect(texts("I've deleted your account.")).toContain(
      'The reply mentions an account deletion but the matching action is off.',
    )
    expect(texts("I've stopped all further payment attempts.")).toContain(
      'The reply mentions stopping the payment retries but the matching action is off.',
    )
  })

  it('checks amounts, period-end wording and em dashes', () => {
    const amount = ruleBasedConsistencyCheck({
      ticketId: 't',
      replyBody: "I've refunded your $15.00 payment.",
      enabledActions: [refund],
    })
    expect(amount.map((m) => m.text).join(' ')).toMatch(
      /\$15\.00 but the refund action is for \$13\.07/,
    )
    const period = ruleBasedConsistencyCheck({
      ticketId: 't',
      replyBody:
        "I've cancelled your subscription. You keep full access until the end of your current billing period.",
      enabledActions: [{ type: 'cancel_immediately', params: {} }],
    })
    expect(period.map((m) => m.text).join(' ')).toMatch(/access until the period end/)
    const dash = ruleBasedConsistencyCheck({
      ticketId: 't',
      replyBody: 'Hi — done.',
      enabledActions: [],
    })
    expect(dash.map((m) => m.text)).toContain('The reply contains an em dash.')
  })

  it('is quiet for a consistent stage-1 refund reply', () => {
    const r = ruleBasedConsistencyCheck({
      ticketId: 't',
      replyBody:
        "I'd be happy to refund your latest payment of $13.07 from September 15. A refund cancels your subscription immediately. Just reply to confirm.",
      enabledActions: [
        refund,
        { type: 'cancel_immediately', params: { stripeSubscriptionId: 's' } },
        send,
      ],
    })
    expect(r).toEqual([])
  })
})

describe('consistency check with a model', () => {
  it('merges model mismatches with the rules and dedupes', async () => {
    const model = createScriptedModelClient([
      {
        toolCalls: [
          {
            name: 'report_mismatches',
            input: {
              mismatches: [
                { severity: 'warning', text: 'The reply names Visa but the card is Mastercard.' },
                { severity: 'error', text: 'The reply contains an em dash.' },
              ],
            },
          },
        ],
      },
    ])
    const r = await consistencyCheck(
      { ticketId: 't', replyBody: 'Hi — refunded to your Visa.', enabledActions: [refund] },
      { model, modelId: 'claude-sonnet-5' },
    )
    const texts = r.mismatches.map((m) => m.text)
    expect(texts.filter((t) => t === 'The reply contains an em dash.')).toHaveLength(1)
    expect(texts).toContain('The reply names Visa but the card is Mastercard.')
    expect(model.requests[0]!.model).toBe('claude-sonnet-5')
  })

  it('falls back to the rules when the model is unavailable or fails', async () => {
    const a = await consistencyCheck(
      { ticketId: 't', replyBody: "I've refunded it.", enabledActions: [] },
      { model: createUnavailableModelClient(), modelId: 'x' },
    )
    expect(a.mismatches).toHaveLength(1)
    const failing = {
      kind: 'anthropic' as const,
      create: async () => {
        throw new Error('boom')
      },
    }
    const b = await consistencyCheck(
      { ticketId: 't', replyBody: "I've refunded it.", enabledActions: [] },
      { model: failing, modelId: 'x' },
    )
    expect(b.mismatches).toHaveLength(1)
  })
})
