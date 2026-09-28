import { describe, expect, it } from 'vitest'
import type { Proposal } from '../../shared/proposal'
import { deriveFacts } from '../../server/agent/context'
import {
  applyRiskPolicy,
  extractDueDate,
  policyWarnings,
  type PolicyContext,
} from '../../server/agent/policy'
import { gatherResearch } from '../../server/agent/research'
import { createFakeTools } from '../../server/agent/tools'
import { ticketRow, messageRow } from '../../evals/harness'
import {
  CASE_1_CANCELLATION,
  CASE_2_REFUND,
  CASE_3_CHARGEBACK,
  CASE_4_BUG,
} from '../../evals/fixtures/cases'
import { NOW } from '../../evals/fixtures/worlds'
import type { Fixture } from '../../evals/fixtures/types'

async function factsFor(fixture: Fixture) {
  const ticket = ticketRow(fixture)
  const messages = fixture.messages.map((m, i) => messageRow(ticket.id, ticket, m, i))
  const research = await gatherResearch({
    ticket,
    messages,
    tools: createFakeTools(fixture.tools),
    emailHistory: async () => [],
    timeoutMs: 5000,
    now: NOW,
    onProgress: () => {},
  })
  const facts = deriveFacts(ticket, research.bundle, NOW)
  return { ticket, messages, facts, research }
}

function ctx(
  facts: Awaited<ReturnType<typeof factsFor>>['facts'],
  over: Partial<PolicyContext> = {},
): PolicyContext {
  return {
    caseType: 'refund_request',
    facts,
    customerText: 'I want a refund',
    latestCustomerText: 'I want a refund',
    receivedAt: NOW.toISOString(),
    now: NOW,
    confirmation: 'none',
    ...over,
  }
}

const action = (
  type: Proposal['actions'][number]['type'],
  params: Record<string, unknown>,
  stage: 'now' | 'after_confirmation' = 'now',
) => ({
  type,
  params,
  reason: 'Because: test',
  stage,
  requiredForReply: false,
  enabled: true,
})

describe('due date extraction', () => {
  const received = '2026-09-27T07:00:00.000Z'
  it('handles "within N days" and business days', () => {
    expect(extractDueDate('Please respond within 10 days.', received)).toBe('2026-10-07')
    expect(extractDueDate('within five business days', received)).toBe('2026-10-02') // Sun 27 → Fri Oct 2
    expect(extractDueDate('within 2 weeks', received)).toBe('2026-10-11')
  })
  it('handles named dates and ISO dates, rolling over the year when needed', () => {
    expect(extractDueDate('Reply by October 7 please', received)).toBe('2026-10-07')
    expect(extractDueDate('no later than 3rd of January', received)).toBe('2027-01-03')
    expect(extractDueDate('deadline is 2026-11-01', received)).toBe('2026-11-01')
    expect(extractDueDate('Nothing here', received)).toBeNull()
  })
})

describe('risk policy', () => {
  it('raises chargebacks to high and extracts the due date', async () => {
    const { facts, messages } = await factsFor(CASE_3_CHARGEBACK)
    const r = applyRiskPolicy(
      { level: 'none', reason: null, dueDate: null },
      ctx(facts, {
        caseType: 'chargeback',
        customerText: messages[0]!.textBody!,
        latestCustomerText: messages[0]!.textBody!,
        receivedAt: messages[0]!.receivedAt!,
      }),
    )
    expect(r.risk.level).toBe('high')
    expect(r.risk.dueDate).toBe('2026-10-07')
    expect(r.notes.join(' ')).toMatch(/Risk raised to high/)
  })
  it('raises long-term customers with an issue, never lowers', async () => {
    const { facts } = await factsFor(CASE_4_BUG)
    expect(facts.isLongTerm).toBe(true)
    expect(
      applyRiskPolicy(
        { level: 'none', reason: null, dueDate: null },
        ctx(facts, { caseType: 'bug_report' }),
      ).risk.level,
    ).toBe('high')
    expect(
      applyRiskPolicy(
        { level: 'safety', reason: 'x', dueDate: null },
        ctx(facts, { caseType: 'bug_report' }),
      ).risk.level,
    ).toBe('safety')
    expect(
      applyRiskPolicy(
        { level: 'none', reason: null, dueDate: null },
        ctx(facts, { caseType: 'feature_request' }),
      ).risk.level,
    ).toBe('none')
  })
  it('raises legal threats and safety cases', async () => {
    const { facts } = await factsFor(CASE_1_CANCELLATION)
    expect(
      applyRiskPolicy(
        { level: 'none', reason: null, dueDate: null },
        ctx(facts, {
          caseType: 'billing_question',
          customerText: 'I will contact my lawyer and dispute the charge with my bank.',
        }),
      ).risk.level,
    ).toBe('high')
    expect(
      applyRiskPolicy(
        { level: 'none', reason: null, dueDate: null },
        ctx(facts, { caseType: 'safety_removal' }),
      ).risk.level,
    ).toBe('safety')
    expect(
      applyRiskPolicy(
        { level: 'none', reason: null, dueDate: null },
        ctx(facts, { caseType: 'cancellation_only' }),
      ).risk.level,
    ).toBe('none')
  })
})

describe('policy warnings', () => {
  it('is quiet for a clean refund inside 30 days', async () => {
    const { facts } = await factsFor(CASE_2_REFUND)
    const w = policyWarnings(
      {
        case: 'refund_request',
        customerConfirmationNeeded: true,
        stage: 1,
        reply: null,
        actions: [
          action(
            'refund_latest_payment',
            { stripePaymentIntentId: 'pi_3QfA7x', amountCents: 1307 },
            'after_confirmation',
          ),
          action(
            'cancel_immediately',
            { stripeSubscriptionId: 'sub_1QfA7y' },
            'after_confirmation',
          ),
        ],
      },
      ctx(facts),
    )
    expect(w).toEqual([])
  })

  it('flags refunds outside 30 days, of older payments, second refunds and partial amounts', async () => {
    const { facts } = await factsFor(CASE_1_CANCELLATION)
    const w = policyWarnings(
      {
        case: 'refund_request',
        customerConfirmationNeeded: false,
        stage: 2,
        reply: null,
        actions: [
          action('refund_latest_payment', { stripeChargeId: 'ch_TBk03', amountCents: 500 }),
        ],
      },
      ctx(facts, {
        facts: {
          ...facts,
          daysSinceLatestPayment: 45,
          refundCount: 1,
          refunds: [
            {
              id: 're_1',
              chargeId: 'ch_TBk02',
              paymentIntentId: null,
              amountCents: 799,
              currency: 'usd',
              status: 'succeeded',
              reason: null,
              created: '2026-05-01T00:00:00Z',
            },
          ],
        },
      }),
    )
    expect(w.join('\n')).toMatch(/outside the 30-day window/)
    expect(w.join('\n')).toMatch(/Only the latest payment is refundable/)
    expect(w.join('\n')).toMatch(/Second refund/)
    expect(w.join('\n')).toMatch(/Partial refund/)
  })

  it('flags deletion without cancellation or confirmation, immediate cancellation for a cancel request and vague reasons', async () => {
    const { facts } = await factsFor(CASE_1_CANCELLATION)
    const w = policyWarnings(
      {
        case: 'account_deletion',
        customerConfirmationNeeded: false,
        stage: 1,
        reply: {
          template: null,
          templateNotionPageId: null,
          to: 'a@b.co',
          subject: 'x',
          body: 'Done, deleted.',
          attachments: [],
        },
        actions: [action('delete_account', { instaradarUserId: 'u', email: 'a@b.co' })],
      },
      ctx(facts, {
        caseType: 'account_deletion',
        latestCustomerText: 'Delete my account, it is not what I expected',
      }),
    )
    expect(w.join('\n')).toMatch(/without prior cancellation/)
    expect(w.join('\n')).toMatch(/without an explicit customer confirmation/)
    expect(w.join('\n')).toMatch(/vague/)
    const cancel = policyWarnings(
      {
        case: 'cancellation_only',
        customerConfirmationNeeded: false,
        stage: 1,
        reply: null,
        actions: [action('cancel_immediately', { stripeSubscriptionId: 'sub_1PzT8c' })],
      },
      ctx(facts, {
        caseType: 'cancellation_only',
        customerText: 'Please unsubscribe me.',
        latestCustomerText: 'Please unsubscribe me.',
      }),
    )
    expect(cancel.join('\n')).toMatch(/cancel at period end instead of immediately/)
  })

  it('does not flag a vague reason when the reply asks first', async () => {
    const { facts } = await factsFor(CASE_1_CANCELLATION)
    const w = policyWarnings(
      {
        case: 'data_accuracy',
        customerConfirmationNeeded: false,
        stage: 1,
        reply: {
          template: null,
          templateNotionPageId: null,
          to: 'a@b.co',
          subject: 'x',
          body: 'Could you tell me what exactly looked off and where?',
          attachments: [],
        },
        actions: [action('send_reply', { to: 'a@b.co' })],
      },
      ctx(facts, { caseType: 'data_accuracy', latestCustomerText: 'Reason: inaccurate' }),
    )
    expect(w).toEqual([])
  })
})
