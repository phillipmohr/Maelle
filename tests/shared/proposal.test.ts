import { describe, expect, it } from 'vitest'
import {
  ProposalSchema,
  formatProposalIssues,
  proposalMetaLine,
  type ProposalInput,
} from '../../shared/proposal'

const base: ProposalInput = {
  case: 'cancellation_only',
  confidence: 0.98,
  risk: { level: 'none', reason: null, dueDate: null },
  customerConfirmationNeeded: false,
  stage: 1,
  summaryLine: 'Cancel at period end, store the reason, send reply.',
  research: [
    {
      text: 'Active Pro Monthly subscription, renews Oct 14, 2026.',
      sources: [{ kind: 'stripe', label: 'Stripe · sub_1PzT8c' }],
    },
  ],
  actions: [
    {
      type: 'cancel_at_period_end',
      params: { stripeSubscriptionId: 'sub_1PzT8c' },
      reason: 'Because: customer asked to unsubscribe',
    },
    {
      type: 'store_cancellation_reason',
      params: { comment: 'Not stated' },
      reason: 'Because: every cancellation is logged',
    },
    {
      type: 'send_reply',
      params: { to: 'tom.becker@web.de' },
      reason: 'Because: confirms the end date',
    },
  ],
  reply: {
    template: 'Cancellation only',
    to: 'tom.becker@web.de',
    subject: 'Re: Unsubscribe',
    body: "Hi Tom, thanks for reaching out!\n\nI've cancelled your subscription.",
  },
  knowledgeRefs: [
    {
      kind: 'template',
      notionPageId: '3e8c931f6ae581429b0ecd9c9abee871',
      title: 'Cancellation only',
    },
  ],
}

describe('ProposalSchema', () => {
  it('accepts a routine proposal and applies defaults', () => {
    const p = ProposalSchema.parse(base)
    expect(p.actions[0]!.stage).toBe('now')
    expect(p.actions[0]!.enabled).toBe(true)
    expect(p.noKnowledgeFound).toBe(false)
    expect(p.reply?.attachments).toEqual([])
  })

  it('accepts a hand-off: the real case, no reply, no actions (IRDR-477)', () => {
    const handoff = {
      ...base,
      case: 'product_question' as const,
      summaryLine: 'Hand over: asks whether story viewers are shown.',
      actions: [],
      reply: null,
      handoff: { reason: 'Asks whether story viewers are shown; no instruction covers it.' },
    }
    expect(ProposalSchema.parse(handoff).handoff?.reason).toMatch(/story viewers/)
    expect(ProposalSchema.parse(base).handoff).toBeNull()

    const withReply = ProposalSchema.safeParse({ ...handoff, reply: base.reply })
    expect(withReply.success).toBe(false)
    if (!withReply.success)
      expect(formatProposalIssues(withReply.error).join('\n')).toMatch(/hand-off has no reply/)

    const withActions = ProposalSchema.safeParse({ ...handoff, actions: base.actions })
    expect(withActions.success).toBe(false)

    const unclear = ProposalSchema.safeParse({
      ...handoff,
      case: 'unclear',
      candidateCases: [{ case: 'product_question', confidence: 0.4 }],
    })
    expect(unclear.success).toBe(false)
    if (!unclear.success)
      expect(formatProposalIssues(unclear.error).join('\n')).toMatch(/keeps the real case/)
  })

  it('validates action params through the registry', () => {
    const r = ProposalSchema.safeParse({
      ...base,
      actions: [{ type: 'send_reply', params: { to: 'nope' }, reason: 'x' }],
    })
    expect(r.success).toBe(false)
    if (!r.success)
      expect(formatProposalIssues(r.error).join('\n')).toMatch(/actions\.0\.params\.to/)
  })

  it('rejects actions out of registry order', () => {
    const r = ProposalSchema.safeParse({
      ...base,
      actions: [
        { type: 'send_reply', params: { to: 'tom.becker@web.de' }, reason: 'x' },
        { type: 'cancel_at_period_end', params: { stripeSubscriptionId: 'sub_1' }, reason: 'y' },
      ],
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(formatProposalIssues(r.error).join('\n')).toMatch(/registry order/)
  })

  it('rejects an em dash in the reply', () => {
    const r = ProposalSchema.safeParse({
      ...base,
      reply: { ...base.reply!, body: 'Hi Tom — done.' },
    })
    expect(r.success).toBe(false)
    if (!r.success) expect(formatProposalIssues(r.error).join('\n')).toMatch(/em dash/)
  })

  it('requires irreversible actions to wait for confirmation in stage 1', () => {
    const r = ProposalSchema.safeParse({
      ...base,
      case: 'refund_request',
      customerConfirmationNeeded: true,
      actions: [
        {
          type: 'refund_latest_payment',
          params: { stripePaymentIntentId: 'pi_1', amountCents: 1307 },
          reason: 'x',
        },
        { type: 'send_reply', params: { to: 'tom.becker@web.de' }, reason: 'y' },
      ],
    })
    expect(r.success).toBe(false)
    const ok = ProposalSchema.safeParse({
      ...base,
      case: 'refund_request',
      customerConfirmationNeeded: true,
      actions: [
        {
          type: 'refund_latest_payment',
          params: { stripePaymentIntentId: 'pi_1', amountCents: 1307 },
          reason: 'x',
          stage: 'after_confirmation',
        },
        { type: 'send_reply', params: { to: 'tom.becker@web.de' }, reason: 'y' },
      ],
    })
    expect(ok.success).toBe(true)
  })

  it('unclear proposals carry candidates and no actions', () => {
    const r = ProposalSchema.safeParse({ ...base, case: 'unclear', actions: [], reply: null })
    expect(r.success).toBe(false)
    const ok = ProposalSchema.safeParse({
      ...base,
      case: 'unclear',
      confidence: 0.4,
      candidateCases: [
        { case: 'billing_question', confidence: 0.4 },
        { case: 'charged_after_cancellation', confidence: 0.35 },
      ],
      actions: [],
      reply: null,
    })
    expect(ok.success).toBe(true)
  })

  it('forces safety risk for safety requests', () => {
    const r = ProposalSchema.safeParse({
      ...base,
      case: 'safety_removal',
      actions: [
        {
          type: 'remove_from_tracking',
          params: { instagramHandle: 'x', reason: 'threats' },
          reason: 'Because: safety',
        },
        { type: 'send_reply', params: { to: 'tom.becker@web.de' }, reason: 'y' },
      ],
    })
    expect(r.success).toBe(false)
  })

  it('computes meta lines', () => {
    const p = ProposalSchema.parse(base)
    expect(proposalMetaLine(p)).toBe('3 actions · all reversible')
    expect(
      proposalMetaLine({
        stage: 1,
        customerConfirmationNeeded: true,
        actions: [
          {
            type: 'refund_latest_payment',
            params: {},
            reason: '',
            stage: 'after_confirmation',
            requiredForReply: false,
            enabled: true,
          },
          {
            type: 'cancel_immediately',
            params: {},
            reason: '',
            stage: 'after_confirmation',
            requiredForReply: false,
            enabled: true,
          },
          {
            type: 'send_reply',
            params: {},
            reason: '',
            stage: 'now',
            requiredForReply: false,
            enabled: true,
          },
        ],
      }),
    ).toBe('Now: 1 action · Queued: 2 irreversible')
    expect(
      proposalMetaLine({
        stage: 1,
        customerConfirmationNeeded: false,
        actions: [
          {
            type: 'send_reply',
            params: {},
            reason: '',
            stage: 'now',
            requiredForReply: false,
            enabled: true,
          },
        ],
      }),
    ).toBe('1 action · reply only')
  })
})
