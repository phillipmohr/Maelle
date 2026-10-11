/**
 * InstaRadar is paused (IRDR-482): the refund facts code computes for the agent, the pause-aware
 * guardrails and the Notion confirmation flag. Both states are covered, so the normal rules stay
 * tested for when the pause ends.
 */
import { describe, expect, it } from 'vitest'
import type { Proposal } from '../../shared/proposal'
import type { CustomerFacts } from '../../server/agent/context'
import { caseRequiresConfirmation } from '../../server/agent/finalize'
import { loadSnapshotKnowledge } from '../../server/agent/knowledge/snapshot'
import {
  isPausedRefundTarget,
  pausedRefundFacts,
  proratedAmount,
} from '../../server/agent/paused-refund'
import { applyRiskPolicy, policyWarnings, type PolicyContext } from '../../server/agent/policy'
import type {
  StripeChargeSummary,
  StripeInvoiceSummary,
  StripeSubscriptionSummary,
} from '../../server/agent/types'

const PAUSED_AT = '2026-10-05T19:48:54Z'

const charge = (over: Partial<StripeChargeSummary>): StripeChargeSummary => ({
  id: 'ch_x',
  paymentIntentId: null,
  invoiceId: null,
  amountCents: 999,
  amountRefundedCents: 0,
  currency: 'usd',
  status: 'succeeded',
  created: '2026-10-02T10:00:00Z',
  card: null,
  disputed: false,
  failureMessage: null,
  description: null,
  ...over,
})

const weekly: StripeSubscriptionSummary = {
  id: 'sub_w',
  status: 'paused',
  plan: 'Pro Weekly',
  interval: 'week',
  amountCents: 999,
  currency: 'usd',
  created: '2026-08-01T10:00:00Z',
  currentPeriodStart: null,
  currentPeriodEnd: PAUSED_AT,
  cancelAtPeriodEnd: false,
  canceledAt: null,
  endedAt: null,
  cancellationReason: null,
}

describe('proratedAmount', () => {
  it('weekly plan: the share from the pause to the period end', () => {
    // Paid Oct 2 10:00 for 7 days; the pause leaves 3 days 14h 11m 6s of 7 days unused.
    const p = proratedAmount({
      amountCents: 999,
      refundedCents: 0,
      periodStart: '2026-10-02T10:00:00Z',
      periodEnd: '2026-10-09T10:00:00Z',
      pausedAt: PAUSED_AT,
    })
    const unused = new Date('2026-10-09T10:00:00Z').getTime() - new Date(PAUSED_AT).getTime()
    expect(p.cents).toBe(Math.round((999 * unused) / (7 * 86_400_000)))
    expect(p.cents).toBe(512)
  })

  it('monthly plan, a period that ended before the pause, a partial refund, zero-decimal', () => {
    const monthly = proratedAmount({
      amountCents: 2999,
      refundedCents: 0,
      periodStart: '2026-09-20T00:00:00Z',
      periodEnd: '2026-10-20T00:00:00Z',
      pausedAt: PAUSED_AT,
    })
    expect(monthly.cents).toBeGreaterThan(1300)
    expect(monthly.cents).toBeLessThan(1500)
    expect(
      proratedAmount({
        amountCents: 999,
        refundedCents: 0,
        periodStart: '2026-09-20T00:00:00Z',
        periodEnd: '2026-09-27T00:00:00Z',
        pausedAt: PAUSED_AT,
      }).cents,
    ).toBe(0)
    // Never more than what is still refundable.
    expect(
      proratedAmount({
        amountCents: 999,
        refundedCents: 900,
        periodStart: '2026-10-02T10:00:00Z',
        periodEnd: '2026-10-09T10:00:00Z',
        pausedAt: PAUSED_AT,
      }).cents,
    ).toBe(99)
    // JPY has no minor unit: the amount is whole yen and the result is whole yen.
    const yen = proratedAmount({
      amountCents: 1500,
      refundedCents: 0,
      periodStart: '2026-10-02T10:00:00Z',
      periodEnd: '2026-10-09T10:00:00Z',
      pausedAt: PAUSED_AT,
    })
    expect(Number.isInteger(yen.cents)).toBe(true)
  })
})

describe('pausedRefundFacts', () => {
  const invoice: StripeInvoiceSummary = {
    id: 'in_pre',
    status: 'paid',
    amountDueCents: 999,
    amountPaidCents: 999,
    currency: 'usd',
    created: '2026-10-02T10:00:00Z',
    paidAt: '2026-10-02T10:00:05Z',
    attemptCount: 1,
    nextPaymentAttempt: null,
    subscriptionId: 'sub_w',
    billingReason: 'subscription_cycle',
    periodStart: '2026-10-02T10:00:00Z',
    periodEnd: '2026-10-09T10:00:00Z',
  }

  it('picks the latest payment before the pause even when a newer post-pause charge exists', () => {
    const facts = pausedRefundFacts({
      charges: [
        charge({
          id: 'ch_post',
          paymentIntentId: 'pi_post',
          created: '2026-10-07T10:00:00Z',
          amountRefundedCents: 999,
        }),
        charge({ id: 'ch_pre', paymentIntentId: 'pi_pre' }),
        charge({ id: 'ch_old', created: '2026-09-25T10:00:00Z' }),
      ],
      invoices: [invoice],
      refunds: [
        {
          id: 're_1',
          chargeId: 'ch_post',
          paymentIntentId: 'pi_post',
          amountCents: 999,
          currency: 'usd',
          status: 'succeeded',
          reason: null,
          created: '2026-10-09T12:00:00Z',
        },
      ],
      subscriptions: [weekly],
      pausedAt: PAUSED_AT,
    })
    expect(facts.prePausePayment).toMatchObject({
      chargeId: 'ch_pre',
      paymentIntentId: 'pi_pre',
      periodSource: 'invoice',
      periodEnd: '2026-10-09T10:00:00Z',
      remainingRefundableCents: 999,
      proratedAmountCents: 512,
    })
    expect(facts.postPauseCharges).toEqual([
      expect.objectContaining({
        chargeId: 'ch_post',
        remainingRefundableCents: 0,
        refundedAt: '2026-10-09T12:00:00Z',
      }),
    ])
    expect(isPausedRefundTarget('pi_pre', facts)).toBe(true)
    expect(isPausedRefundTarget('ch_post', facts)).toBe(true)
    expect(isPausedRefundTarget('ch_old', facts)).toBe(false)
  })

  it('estimates the period from the plan interval when no invoice period is known', () => {
    const facts = pausedRefundFacts({
      charges: [charge({ id: 'ch_pre' })],
      invoices: [],
      refunds: [],
      subscriptions: [weekly],
      pausedAt: PAUSED_AT,
    })
    expect(facts.prePausePayment).toMatchObject({
      periodSource: 'plan',
      periodStart: '2026-10-02T10:00:00Z',
      periodEnd: '2026-10-09T10:00:00.000Z',
      proratedAmountCents: 512,
    })
  })

  it('has no pre-pause payment when every payment is from after the pause', () => {
    const facts = pausedRefundFacts({
      charges: [charge({ id: 'ch_post', created: '2026-10-07T10:00:00Z' })],
      invoices: [],
      refunds: [],
      subscriptions: [weekly],
      pausedAt: PAUSED_AT,
    })
    expect(facts.prePausePayment).toBeNull()
    expect(facts.postPauseCharges).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- guardrails

function factsWith(over: Partial<CustomerFacts>): CustomerFacts {
  const base = {
    stripeCustomerId: 'cus_1',
    instaradarUserId: null,
    customerName: 'Test',
    plan: 'Pro Weekly',
    subscriptionStatus: 'paused',
    activeSubscription: weekly,
    latestSubscription: weekly,
    renewalDate: null,
    accessUntil: null,
    cancellationDate: null,
    customerSince: '2025-01-01T00:00:00Z',
    customerDays: 640,
    card: null,
    cardLabel: null,
    latestPayment: {
      chargeId: 'ch_post',
      paymentIntentId: 'pi_post',
      amountCents: 999,
      currency: 'usd',
      date: '2026-10-07T10:00:00Z',
      cardLabel: null,
    },
    daysSinceLatestPayment: 40,
    payments: [],
    refunds: [
      {
        id: 're_post',
        chargeId: 'ch_post',
        paymentIntentId: 'pi_post',
        amountCents: 999,
        currency: 'usd',
        status: 'succeeded',
        reason: null,
        created: '2026-10-09T12:00:00Z',
      },
    ],
    refundCount: 1,
    openDisputes: [],
    latestChargeDisputed: false,
    failedPayments: 0,
    openInvoices: 0,
    catchUpPayments: 0,
    subscriptionsCount: 1,
    resubscribed: false,
    trackedProfiles: [],
    signIns: 0,
    lastSignInAt: null,
    logErrors: null,
    previousTickets: 0,
    isLongTerm: true,
    isNewCustomer: false,
    tags: ['Long-term'],
    prePausePayment: {
      chargeId: 'ch_pre',
      paymentIntentId: 'pi_pre',
      date: '2026-10-02T10:00:00Z',
      amountCents: 999,
      currency: 'usd',
      periodStart: '2026-10-02T10:00:00Z',
      periodEnd: '2026-10-09T10:00:00Z',
      periodSource: 'invoice',
      refundedCents: 0,
      remainingRefundableCents: 999,
      unusedDays: 3.6,
      periodDays: 7,
      proratedAmountCents: 512,
    },
    postPauseCharges: [],
  } satisfies CustomerFacts
  return { ...base, ...over }
}

const ctxFor = (paused: boolean, over: Partial<PolicyContext> = {}): PolicyContext => ({
  caseType: 'refund_request',
  facts: factsWith({}),
  customerText: 'It stopped working, I want my money back.',
  latestCustomerText: 'It stopped working, I want my money back.',
  receivedAt: '2026-10-10T10:00:00Z',
  now: new Date('2026-10-11T10:00:00Z'),
  confirmation: 'confirmed',
  servicePaused: paused,
  ...over,
})

const refundProposal = (target: string, amountCents: number): Proposal =>
  ({
    case: 'refund_request',
    stage: 2,
    customerConfirmationNeeded: false,
    reply: { to: 'a@b.c', subject: 'Re: x', body: 'I refunded it.', attachments: [] },
    actions: [
      {
        type: 'refund_latest_payment',
        params: { stripePaymentIntentId: target, amountCents, currency: 'usd' },
        enabled: true,
        stage: 'now',
        requiredForReply: true,
        reason: 'Because: prorated',
      },
      {
        type: 'cancel_immediately',
        params: { stripeSubscriptionId: 'sub_w' },
        enabled: true,
        stage: 'now',
        requiredForReply: false,
        reason: 'Because: refund',
      },
      {
        type: 'send_reply',
        params: { to: 'a@b.c' },
        enabled: true,
        stage: 'now',
        requiredForReply: false,
        reason: 'Because: reply',
      },
    ],
  }) as unknown as Proposal

describe('pause-aware guardrails', () => {
  it('while paused: no 30-day, second-refund, partial-refund or vague-reason warning for the pre-pause payment', () => {
    expect(policyWarnings(refundProposal('pi_pre', 510), ctxFor(true))).toEqual([])
  })

  it('not paused: the same proposal gets the old warnings', () => {
    const w = policyWarnings(refundProposal('pi_pre', 510), ctxFor(false))
    expect(w.some((x) => /outside the 30-day window/.test(x))).toBe(true)
    expect(w.some((x) => /Second refund/.test(x))).toBe(true)
    expect(w.some((x) => /Partial refund/.test(x))).toBe(true)
    expect(w.some((x) => /The refund targets pi_pre/.test(x))).toBe(true)
    expect(w.some((x) => /reason is vague/.test(x))).toBe(true)
  })

  it('while paused: a refund of any other payment still warns', () => {
    const w = policyWarnings(refundProposal('pi_old', 999), ctxFor(true))
    expect(w).toEqual([expect.stringMatching(/The refund targets pi_old/)])
  })

  it('while paused: a long-term customer with an issue is not raised to high risk', () => {
    const risk = { level: 'none' as const, reason: null, dueDate: null }
    const issue = { caseType: 'bug_report' as const }
    expect(applyRiskPolicy(risk, ctxFor(true, issue)).risk.level).toBe('none')
    expect(applyRiskPolicy(risk, ctxFor(false, issue)).risk.level).toBe('high')
    // Chargebacks stay high either way.
    expect(applyRiskPolicy(risk, ctxFor(true, { caseType: 'chargeback' })).risk.level).toBe('high')
  })

  it('a cancellation that cancels immediately without a refund still warns', () => {
    const p = {
      ...refundProposal('pi_pre', 510),
      case: 'cancellation_only',
      actions: refundProposal('pi_pre', 510).actions.filter(
        (a) => a.type !== 'refund_latest_payment',
      ),
    } as Proposal
    const w = policyWarnings(p, ctxFor(true, { caseType: 'cancellation_only' }))
    expect(w.some((x) => /cancel at period end instead of immediately/.test(x))).toBe(true)
  })
})

describe('Notion "Requires confirmation" wins over the code registry', () => {
  it('account deletion needs no confirmation in Notion (holding reply), refunds do', async () => {
    const knowledge = await loadSnapshotKnowledge()
    expect(caseRequiresConfirmation('account_deletion', knowledge)).toBe(false)
    expect(caseRequiresConfirmation('refund_request', knowledge)).toBe(true)
    expect(caseRequiresConfirmation('cancellation_only', knowledge)).toBe(false)
    // Without a template the code registry decides.
    expect(caseRequiresConfirmation('account_deletion', { ...knowledge, templates: [] })).toBe(true)
  })
})
