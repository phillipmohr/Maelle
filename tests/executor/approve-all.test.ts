/**
 * "Approve & send all" (IRDR-481): the bulk guards and the approval loop, without a database. The
 * database flow (real context loader, real executor) is in tests/db/executor/approve-all.test.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ApproveInput } from '../../shared/services'
import {
  failedGuard,
  type EvaluateContext,
  type EvaluateProposal,
  type EvaluateTicket,
} from '../../server/autonomy/evaluate'
import {
  approveAll,
  decideBulk,
  previewApproveAll,
  type ApproveAllDeps,
} from '../../server/executor/approve-all'

const ticket = (n: number, over: Partial<EvaluateTicket> = {}): EvaluateTicket => ({
  id: `00000000-0000-4000-8000-00000000${String(n).padStart(4, '0')}`,
  displayNumber: n,
  customerName: 'Tom Becker',
  customerEmail: 'tom.becker@web.de',
  status: 'needs_decision',
  caseType: 'cancellation_only',
  riskLevel: 'none',
  dueDate: null,
  ...over,
})

const proposal: EvaluateProposal = {
  version: 1,
  caseType: 'cancellation_only',
  riskLevel: 'none',
  policyWarnings: [],
  customerConfirmationNeeded: false,
  stage: 1,
  actions: [
    { type: 'cancel_at_period_end', enabled: true, stage: 'now' },
    { type: 'store_cancellation_reason', enabled: true, stage: 'now' },
    { type: 'send_reply', enabled: true, stage: 'now' },
  ],
}

const ctx = (over: Partial<EvaluateContext> = {}): EvaluateContext => ({
  ticket: ticket(4824),
  proposal,
  // Bulk is Phillip's own decision: the Auto settings never matter.
  mode: 'always_ask',
  globalPause: true,
  locks: {},
  databaseConfigured: true,
  ...over,
})

describe('failedGuard without the Auto settings', () => {
  it('ignores global pause and the mode, keeps every other guard', () => {
    expect(failedGuard(ctx(), { settings: false })).toBeNull()
    expect(failedGuard(ctx())?.reason).toBe('paused')
    expect(failedGuard(ctx({ globalPause: false }))?.reason).toBe('always_ask')
    expect(
      failedGuard(ctx({ ticket: ticket(1, { riskLevel: 'safety' }) }), { settings: false })?.reason,
    ).toBe('safety')
    expect(
      failedGuard(ctx({ proposal: { ...proposal, policyWarnings: ['x'] } }), { settings: false })
        ?.reason,
    ).toBe('policy_warnings')
  })
})

describe('decideBulk', () => {
  it('sends a plain cancellation as proposed, pinned to its proposal version', () => {
    expect(decideBulk(ctx({ proposal: { ...proposal, version: 3 } }))).toEqual({
      send: true,
      ticket: {
        ticketId: ticket(4824).id,
        displayNumber: 4824,
        customerName: 'Tom Becker',
        customerEmail: 'tom.becker@web.de',
        caseType: 'cancellation_only',
        proposalVersion: 3,
        refund: null,
      },
    })
  })

  it('skips risky, unclear, handed-off, warned and confirmation-pending tickets', () => {
    const reason = (c: EvaluateContext) => {
      const v = decideBulk(c)
      return v.send ? 'send' : v.reason
    }
    expect(reason(ctx({ ticket: ticket(1, { riskLevel: 'high' }) }))).toBe('high_risk')
    expect(reason(ctx({ proposal: { ...proposal, riskLevel: 'safety' } }))).toBe('safety')
    expect(reason(ctx({ proposal: { ...proposal, caseType: 'unclear' } }))).toBe('unclear')
    expect(reason(ctx({ proposal: { ...proposal, handoffReason: 'No template fits' } }))).toBe(
      'handoff',
    )
    expect(reason(ctx({ proposal: { ...proposal, policyWarnings: ['Over the limit'] } }))).toBe(
      'policy_warnings',
    )
    // Stage 1 where the refund would run before the customer's answer.
    expect(
      reason(
        ctx({
          proposal: {
            ...proposal,
            customerConfirmationNeeded: true,
            actions: [
              { type: 'refund_latest_payment', enabled: true, stage: 'now' },
              { type: 'send_reply', enabled: true, stage: 'now' },
            ],
          },
        }),
      ),
    ).toBe('confirmation_pending')
    expect(reason(ctx({ proposal: null }))).toBe('no_proposal')
    expect(reason(ctx({ ticket: null }))).toBe('not_waiting')
    expect(reason(ctx({ ticket: ticket(1, { status: 'executing' }) }))).toBe('not_waiting')
  })

  it('sends refunds and immediate cancellations (locks are for Auto), with the refund amount (IRDR-482)', () => {
    const refund: EvaluateProposal = {
      ...proposal,
      caseType: 'refund_request',
      stage: 2,
      actions: [
        {
          type: 'refund_latest_payment',
          enabled: true,
          stage: 'now',
          params: { amountCents: 512, currency: 'usd' },
        },
        { type: 'cancel_immediately', enabled: true, stage: 'now' },
        { type: 'send_reply', enabled: true, stage: 'now' },
      ],
    }
    expect(decideBulk(ctx({ proposal: refund }))).toMatchObject({
      send: true,
      ticket: { refund: { amountCents: 512, currency: 'usd' } },
    })
  })

  it('sends a stage-1 proposal: only the reply goes out, the queued refund waits', () => {
    const stage1: EvaluateProposal = {
      ...proposal,
      caseType: 'refund_request',
      customerConfirmationNeeded: true,
      actions: [
        { type: 'refund_latest_payment', enabled: true, stage: 'after_confirmation' },
        { type: 'send_reply', enabled: true, stage: 'now' },
      ],
    }
    expect(decideBulk(ctx({ proposal: stage1 }))).toMatchObject({
      send: true,
      ticket: { refund: null },
    })
  })

  it('never sends Delete account in bulk', () => {
    const deletion: EvaluateProposal = {
      ...proposal,
      actions: [
        { type: 'delete_account', enabled: true, stage: 'now' },
        { type: 'send_reply', enabled: true, stage: 'now' },
      ],
    }
    expect(decideBulk(ctx({ proposal: deletion }))).toEqual({
      send: false,
      reason: 'irreversible_action',
      detail: 'Delete account is never sent in bulk',
    })
  })

  it('skips a proposal whose Send reply is off', () => {
    const noReply: EvaluateProposal = {
      ...proposal,
      actions: proposal.actions.map((a) =>
        a.type === 'send_reply' ? { ...a, enabled: false } : a,
      ),
    }
    expect(decideBulk(ctx({ proposal: noReply }))).toMatchObject({
      send: false,
      reason: 'no_reply',
    })
  })
})

function deps(contexts: EvaluateContext[], approve?: ApproveAllDeps['approve']): ApproveAllDeps {
  const byId = new Map(contexts.map((c) => [c.ticket!.id, c]))
  return {
    candidates: async () => [...byId.keys()],
    loadContext: async (id) => byId.get(id)!,
    approve: approve ?? (async () => ({ decisionId: 'd', ticketStatus: 'closed', executions: [] })),
  }
}

describe('previewApproveAll', () => {
  it('splits the candidates into eligible and skipped with the reason', async () => {
    const ok = ctx({ ticket: ticket(1) })
    const risky = ctx({ ticket: ticket(2, { riskLevel: 'high' }) })
    const res = await previewApproveAll(deps([ok, risky]))
    expect(res.eligible.map((t) => t.displayNumber)).toEqual([1])
    expect(res.skipped).toEqual([
      {
        ticketId: ticket(2).id,
        displayNumber: 2,
        reason: 'high_risk',
        detail: 'High-risk tickets always wait for you',
      },
    ])
  })
})

describe('approveAll', () => {
  it('approves each requested ticket as proposed (no edits; irreversible actions confirmed)', async () => {
    const approve = vi.fn(async () => ({ decisionId: 'd', ticketStatus: 'closed', executions: [] }))
    const a = ctx({ ticket: ticket(1) })
    const b = ctx({ ticket: ticket(2), proposal: { ...proposal, version: 2 } })
    const res = await approveAll(deps([a, b], approve), {
      tickets: [
        { ticketId: ticket(1).id, proposalVersion: 1 },
        { ticketId: ticket(2).id, proposalVersion: 2 },
        { ticketId: ticket(1).id, proposalVersion: 1 }, // a double entry runs once
      ],
    })
    expect(approve.mock.calls).toEqual([
      [
        ticket(1).id,
        { proposalVersion: 1, actions: [], confirmIrreversible: true } satisfies ApproveInput,
      ],
      [
        ticket(2).id,
        { proposalVersion: 2, actions: [], confirmIrreversible: true } satisfies ApproveInput,
      ],
    ])
    expect(res).toEqual({
      sent: [
        { ticketId: ticket(1).id, displayNumber: 1, ticketStatus: 'closed' },
        { ticketId: ticket(2).id, displayNumber: 2, ticketStatus: 'closed' },
      ],
      skipped: [],
      failed: [],
    })
  })

  it('skips a ticket whose draft changed, or that is no longer eligible or waiting', async () => {
    const approve = vi.fn(async () => ({ decisionId: 'd', ticketStatus: 'closed', executions: [] }))
    const regenerated = ctx({ ticket: ticket(1), proposal: { ...proposal, version: 2 } })
    const nowRisky = ctx({ ticket: ticket(2, { riskLevel: 'high' }) })
    const res = await approveAll(deps([regenerated, nowRisky], approve), {
      tickets: [
        { ticketId: ticket(1).id, proposalVersion: 1 },
        { ticketId: ticket(2).id, proposalVersion: 1 },
        { ticketId: ticket(3).id, proposalVersion: 1 }, // sent in the meantime: no candidate
      ],
    })
    expect(approve).not.toHaveBeenCalled()
    expect(res.sent).toEqual([])
    expect(res.skipped.map((s) => [s.displayNumber, s.reason])).toEqual([
      [1, 'stale_version'],
      [2, 'high_risk'],
      [null, 'not_waiting'],
    ])
  })

  it('counts an approval whose reply failed as failed, not sent', async () => {
    const approve = vi.fn(async () => ({
      decisionId: 'd',
      ticketStatus: 'action_failed',
      executions: [
        { executionId: 'e1', type: 'cancel_at_period_end' as const, status: 'succeeded' as const },
        {
          executionId: 'e2',
          type: 'send_reply' as const,
          status: 'failed' as const,
          error: 'Mailbox rejected the message',
        },
      ],
    }))
    const res = await approveAll(deps([ctx({ ticket: ticket(1) })], approve), {
      tickets: [{ ticketId: ticket(1).id, proposalVersion: 1 }],
    })
    expect(res.sent).toEqual([])
    expect(res.failed).toEqual([
      {
        ticketId: ticket(1).id,
        displayNumber: 1,
        error: 'Send reply failed: Mailbox rejected the message',
      },
    ])
  })

  it('records a failed approval and goes on with the rest', async () => {
    const approve = vi.fn(async (id: string) => {
      if (id === ticket(1).id) throw new Error('Stripe is down')
      return { decisionId: 'd', ticketStatus: 'closed', executions: [] }
    })
    const res = await approveAll(
      deps([ctx({ ticket: ticket(1) }), ctx({ ticket: ticket(2) })], approve),
      {
        tickets: [
          { ticketId: ticket(1).id, proposalVersion: 1 },
          { ticketId: ticket(2).id, proposalVersion: 1 },
        ],
      },
    )
    expect(res.failed).toEqual([
      { ticketId: ticket(1).id, displayNumber: 1, error: 'Stripe is down' },
    ])
    expect(res.sent.map((s) => s.displayNumber)).toEqual([2])
  })
})
