/**
 * "Approve & send all" (IRDR-481) against the real schema (pnpm test:db): the real candidate query,
 * the real context loader and the real executor with the in-memory fakes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { findRegenerableDrafts } from '../../../server/agent/regenerate'
import { loadEvaluateContextFromDb } from '../../../server/autonomy/context'
import {
  approveAll,
  previewApproveAll,
  type ApproveAllDeps,
} from '../../../server/executor/approve-all'
import { setupExecutorTest, TEST_URL, type ExecutorTest, type TicketSpec } from './setup'

const featureSpec = (email: string): TicketSpec => ({
  caseType: 'feature_request',
  email,
  actions: [
    {
      type: 'create_linear_ticket',
      params: {
        title: 'Dark mode',
        description: 'Please add dark mode.',
        label: 'Feature',
        customerEmail: email,
      },
    },
    {
      type: 'store_release_notification_email',
      params: { fromActionPosition: 0, email },
      requiredForReply: true,
    },
    { type: 'send_reply', params: { to: email } },
  ],
})

describe.skipIf(!TEST_URL)('approve & send all', () => {
  let t: ExecutorTest
  let deps: ApproveAllDeps

  beforeAll(async () => {
    t = await setupExecutorTest('approve_all')
    deps = {
      candidates: findRegenerableDrafts,
      loadContext: loadEvaluateContextFromDb,
      approve: (id, input) => t.executor.approve(id, input, 'you'),
    }
  })
  afterAll(async () => {
    await t?.teardown()
  })

  it('previews the drafts and skips deletions, warned and risky ones, whatever Auto says', async () => {
    // Auto settings and locks don't matter for Phillip's own bulk decision.
    await t.q('update public.settings set global_pause = true where app_id = $1', [t.appId])
    const ok = await t.insertTicket(featureSpec('bulk-ok@example.com'))
    const deletion = await t.insertTicket({
      caseType: 'account_deletion',
      actions: [
        {
          type: 'delete_account',
          params: { instaradarUserId: 'u_bulk', email: 'bulk-del@example.com' },
        },
        { type: 'send_reply', params: { to: 'bulk-del@example.com' } },
      ],
      email: 'bulk-del@example.com',
    })
    const refund = await t.insertTicket({
      caseType: 'refund_request',
      stage: 2,
      actions: [
        {
          type: 'refund_latest_payment',
          params: { stripePaymentIntentId: 'pi_prev', amountCents: 512, currency: 'usd' },
        },
        { type: 'send_reply', params: { to: 'bulk-refund@example.com' } },
      ],
      email: 'bulk-refund@example.com',
    })
    const warned = await t.insertTicket({
      ...featureSpec('bulk-warned@example.com'),
      policyWarnings: ['Over the refund limit'],
    })
    const risky = await t.insertTicket({ ...featureSpec('bulk-risky@example.com'), risk: 'high' })

    const preview = await previewApproveAll(deps)
    expect(preview.eligible.find((e) => e.ticketId === ok.ticketId)).toEqual({
      ticketId: ok.ticketId,
      displayNumber: ok.displayNumber,
      customerName: 'Test Customer',
      customerEmail: 'bulk-ok@example.com',
      caseType: 'feature_request',
      proposalVersion: 1,
      refund: null,
    })
    // The locked refund is eligible in bulk and its amount shows up for the dialog's total.
    expect(preview.eligible.find((e) => e.ticketId === refund.ticketId)?.refund).toEqual({
      amountCents: 512,
      currency: 'usd',
    })
    const reasons = new Map(preview.skipped.map((s) => [s.ticketId, s.reason]))
    expect(reasons.get(deletion.ticketId)).toBe('irreversible_action')
    expect(reasons.get(warned.ticketId)).toBe('policy_warnings')
    expect(reasons.get(risky.ticketId)).toBe('high_risk')
    for (const id of [deletion.ticketId, warned.ticketId, risky.ticketId])
      expect(preview.eligible.some((e) => e.ticketId === id)).toBe(false)
    await t.q('update public.settings set global_pause = false where app_id = $1', [t.appId])
  })

  it('sends as proposed: the same decision and actions as a single approval without edits', async () => {
    const bulk = await t.insertTicket(featureSpec('bulk-same@example.com'))
    const single = await t.insertTicket(featureSpec('single-same@example.com'))
    const deletion = await t.insertTicket({
      caseType: 'account_deletion',
      actions: [
        {
          type: 'delete_account',
          params: { instaradarUserId: 'u_bulk2', email: 'bulk-del2@example.com' },
        },
        { type: 'send_reply', params: { to: 'bulk-del2@example.com' } },
      ],
      email: 'bulk-del2@example.com',
    })
    const mailBefore = t.mail.sent.length

    await t.executor.approve(
      single.ticketId,
      { proposalVersion: 1, actions: t.allEnabled(3) },
      'you',
    )
    const res = await approveAll(deps, {
      tickets: [
        { ticketId: bulk.ticketId, proposalVersion: 1 },
        // Not eligible (Delete account): requested anyway, still never approved.
        { ticketId: deletion.ticketId, proposalVersion: 1 },
      ],
    })

    expect(res.failed).toEqual([])
    expect(res.sent).toEqual([
      { ticketId: bulk.ticketId, displayNumber: bulk.displayNumber, ticketStatus: 'closed' },
    ])
    expect(res.skipped).toMatchObject([
      { ticketId: deletion.ticketId, reason: 'irreversible_action' },
    ])

    const shape = async (id: string) =>
      (await t.executions(id)).map((e) => [e.action_type, e.status, e.executed_by])
    expect(await shape(bulk.ticketId)).toEqual(await shape(single.ticketId))
    expect(await shape(bulk.ticketId)).toEqual([
      ['create_linear_ticket', 'succeeded', 'you'],
      ['store_release_notification_email', 'succeeded', 'you'],
      ['send_reply', 'succeeded', 'you'],
    ])
    expect((await t.decisions(bulk.ticketId)).map((d) => d.decision)).toEqual(['approved'])
    expect(await t.executions(deletion.ticketId)).toEqual([])
    expect((await t.ticket(deletion.ticketId)).status).toBe('needs_decision')
    expect(t.mail.sent.slice(mailBefore).map((m) => m.to)).toEqual([
      'single-same@example.com',
      'bulk-same@example.com',
    ])
  })

  it('runs a refund and an immediate cancellation in bulk, confirmed and as proposed (IRDR-482)', async () => {
    t.fakes.stripe.seedCustomer({
      customer: 'cus_bulk',
      subscription: 'sub_bulk',
      paymentIntent: 'pi_bulk',
      charge: 'ch_bulk',
      amount: 999,
    })
    const { ticketId, displayNumber } = await t.insertTicket({
      caseType: 'refund_request',
      stage: 2,
      email: 'bulk-money@example.com',
      stripeCustomerId: 'cus_bulk',
      actions: [
        {
          type: 'refund_latest_payment',
          params: { stripePaymentIntentId: 'pi_bulk', amountCents: 512, currency: 'usd' },
        },
        { type: 'cancel_immediately', params: { stripeSubscriptionId: 'sub_bulk' } },
        { type: 'send_reply', params: { to: 'bulk-money@example.com' } },
      ],
    })
    const res = await approveAll(deps, { tickets: [{ ticketId, proposalVersion: 1 }] })
    expect(res.failed).toEqual([])
    expect(res.sent).toEqual([{ ticketId, displayNumber, ticketStatus: 'closed' }])
    expect(t.fakes.stripe.state.charges.get('ch_bulk')!.amountRefunded).toBe(512)
    expect(t.fakes.stripe.state.subscriptions.get('sub_bulk')!.status).toBe('canceled')
  })

  it('skips a draft that changed after the dialog opened and sends nothing for it', async () => {
    const changed = await t.insertTicket(featureSpec('bulk-changed@example.com'))
    // The dialog showed v1; a regenerate replaced it with v2 since.
    await t.q(`update public.proposals set version = 2 where id = $1`, [changed.proposalId])
    const res = await approveAll(deps, {
      tickets: [{ ticketId: changed.ticketId, proposalVersion: 1 }],
    })
    expect(res.sent).toEqual([])
    expect(res.skipped).toMatchObject([{ ticketId: changed.ticketId, reason: 'stale_version' }])
    expect(await t.executions(changed.ticketId)).toEqual([])
    expect((await t.ticket(changed.ticketId)).status).toBe('needs_decision')
  })

  it('reports a bounced reply as failed and goes on with the next ticket', async () => {
    const bounced = await t.insertTicket(featureSpec('bulk-bounce@example.com'))
    const next = await t.insertTicket(featureSpec('bulk-next@example.com'))
    t.mail.failNext = new Error('Mailbox rejected the message')
    const res = await approveAll(deps, {
      tickets: [
        { ticketId: bounced.ticketId, proposalVersion: 1 },
        { ticketId: next.ticketId, proposalVersion: 1 },
      ],
    })
    expect(res.failed).toHaveLength(1)
    expect(res.failed[0]).toMatchObject({ ticketId: bounced.ticketId })
    expect(res.failed[0]!.error).toMatch(/^Send reply failed/)
    expect(res.sent.map((s) => s.ticketId)).toEqual([next.ticketId])
    expect((await t.ticket(bounced.ticketId)).status).toBe('action_failed')
  })
})
