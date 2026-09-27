/**
 * Decision flow against the real schema (pnpm test:db): approve, confirm, stage 1, retry, edits,
 * partial failures, reject and manual send. External systems are the in-memory fakes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deterministicUuid as uid } from '../../../shared/utils/ids'
import { ConfirmRequiredError } from '../../../server/executor/decision'
import { ProviderError } from '../../../server/executor/errors'
import { rateLimitError } from '../../../server/executor/clients/stripe-fake'
import { setupExecutorTest, TEST_URL, type ExecutorTest } from './setup'

const TOM = uid('ticket:4824')
const DANIEL = uid('ticket:4809')
const MARCO = uid('ticket:4822')
const PRIYA = uid('ticket:4820')

describe.skipIf(!TEST_URL)('executor decision flow', () => {
  let t: ExecutorTest

  beforeAll(async () => {
    t = await setupExecutorTest('flow')
    const oct14 = Math.floor(Date.UTC(2026, 9, 14) / 1000)
    t.fakes.stripe.seedCustomer({
      customer: 'cus_TBecker0203',
      subscription: 'sub_1PzT8c',
      paymentIntent: 'pi_tom',
      charge: 'ch_tom',
      amount: 799,
      currentPeriodEnd: oct14,
    })
    t.fakes.stripe.seedCustomer({
      customer: 'cus_DOkafor2291',
      subscription: 'sub_1Qd2Ln',
      paymentIntent: 'pi_3Qd2Lm',
      charge: 'ch_daniel',
      amount: 1307,
    })
    t.fakes.stripe.seedCustomer({
      customer: 'cus_MBianchi8820',
      subscription: 'sub_1QfA7y',
      paymentIntent: 'pi_3QfA7x',
      charge: 'ch_marco',
      amount: 1307,
    })
    t.fakes.linear.addIssue({
      identifier: 'INS-198',
      title: 'False post deleted alerts when the CDN returns 404',
    })
  })
  afterAll(async () => {
    await t?.teardown()
  })

  it('approves Tom #4824: actions in registry order, reply last, every row in the audit log, ticket closed', async () => {
    const res = await t.executor.approve(
      '4824',
      { proposalVersion: 1, actions: t.allEnabled(3) },
      'you',
    )
    expect(res.ticketStatus).toBe('closed')
    expect(res.decisionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(res.executions.map((e) => [e.type, e.status])).toEqual([
      ['cancel_at_period_end', 'succeeded'],
      ['store_cancellation_reason', 'succeeded'],
      ['send_reply', 'succeeded'],
    ])
    const ticket = await t.ticket('4824')
    expect(ticket.status).toBe('closed')
    expect(ticket.resolution).toBe('approved')
    expect(ticket.closed_at).not.toBeNull()
    const rows = await t.executions(TOM)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.idempotency_key)).toEqual([
      `${TOM}:v1:p0`,
      `${TOM}:v1:p1`,
      `${TOM}:v1:p2`,
    ])
    for (const r of rows) {
      expect(r.executed_by).toBe('you')
      expect(r.status).toBe('succeeded')
      expect(r.result).not.toBeNull()
      expect(r.finished_at).not.toBeNull()
      expect(r.irreversible).toBe(false)
    }
    expect((rows[0]!.result as { accessUntil: string }).accessUntil).toBe('2026-10-14')
    expect((rows[2]!.params as { draft: { body: string } }).draft.body).toMatch(
      /cancelled your subscription/,
    )
    const decisions = await t.decisions(TOM)
    expect(decisions).toHaveLength(1)
    expect(decisions[0]).toMatchObject({
      decision: 'approved',
      reply_diff: null,
      action_changes: null,
    })
    expect(Number(decisions[0]!.time_to_decide_ms)).toBeGreaterThan(0)
    expect(await t.proposalStatus(TOM)).toMatchObject({ status: 'decided', version: 1 })
    const reasons = await t.q('select * from public.cancellation_reasons where ticket_id = $1', [
      TOM,
    ])
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toMatchObject({
      stripe_feedback: 'other',
      verbatim_reason: 'Not stated',
      customer_email: 'tom.becker@web.de',
    })
    expect(t.fakes.stripe.state.subscriptions.get('sub_1PzT8c')?.cancelAtPeriodEnd).toBe(true)
    expect(t.mail.sent).toEqual([
      expect.objectContaining({
        ticketId: TOM,
        to: 'tom.becker@web.de',
        sentBy: 'you',
        idempotencyKey: `${TOM}:v1:p2`,
      }),
    ])
  })

  it('refuses a second approve of Tom: nothing runs twice', async () => {
    const calls = t.fakes.stripe.calls.length
    await expect(
      t.executor.approve('4824', { proposalVersion: 1, actions: t.allEnabled(3) }, 'you'),
    ).rejects.toMatchObject({ statusCode: 409, data: { error: 'wrong_status', status: 'closed' } })
    expect(t.mail.sent).toHaveLength(1)
    expect(t.fakes.stripe.calls).toHaveLength(calls)
    expect(await t.executions(TOM)).toHaveLength(3)
  })

  it('runs exactly once when the same approve is submitted twice in parallel', async () => {
    t.fakes.stripe.seedCustomer({
      customer: 'cus_par',
      subscription: 'sub_par',
      paymentIntent: 'pi_par',
      charge: 'ch_par',
      amount: 799,
    })
    const { ticketId } = await t.insertTicket({
      caseType: 'cancellation_only',
      stripeCustomerId: 'cus_par',
      actions: [
        { type: 'cancel_at_period_end', params: { stripeSubscriptionId: 'sub_par' } },
        { type: 'send_reply', params: { to: 'par@example.com' } },
      ],
    })
    const input = { proposalVersion: 1, actions: t.allEnabled(2) }
    const before = t.mail.sent.length
    const results = await Promise.allSettled([
      t.executor.approve(ticketId, input, 'you'),
      t.executor.approve(ticketId, input, 'you'),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ statusCode: 409 })
    expect(t.mail.sent).toHaveLength(before + 1)
    expect(await t.executions(ticketId)).toHaveLength(2)
    expect(
      t.fakes.stripe.calls.filter((c) => c.op === 'updateSubscription' && c.args[0] === 'sub_par'),
    ).toHaveLength(1)
  })

  it('Daniel #4809 v2: 409 with the irreversible list, stale version, then the confirmed approve refunds and cancels once', async () => {
    const input = { proposalVersion: 2, actions: t.allEnabled(3) }
    let caught: unknown
    try {
      await t.executor.approve('4809', input, 'you')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ConfirmRequiredError)
    expect((caught as ConfirmRequiredError).body).toEqual({
      error: 'confirm_required',
      irreversible: [
        { position: 0, type: 'refund_latest_payment', effect: 'Refund $13.07 to Visa ··2291' },
        {
          position: 1,
          type: 'cancel_immediately',
          effect: 'Cancel immediately and delete 2 tracked profiles',
        },
      ],
    })
    // Nothing was written by the refused attempt.
    expect((await t.ticket('4809')).status).toBe('needs_decision')
    expect(await t.decisions(DANIEL)).toHaveLength(1)
    expect(await t.executions(DANIEL)).toHaveLength(1)
    expect(t.fakes.stripe.state.refunds.size).toBe(0)

    await expect(
      t.executor.approve('4809', { ...input, proposalVersion: 1 }, 'you'),
    ).rejects.toMatchObject({
      statusCode: 409,
      data: { error: 'stale_version', current: 2 },
    })

    const res = await t.executor.approve('4809', { ...input, confirmIrreversible: true }, 'you')
    expect(res.ticketStatus).toBe('closed')
    expect(res.executions.map((e) => [e.type, e.status])).toEqual([
      ['refund_latest_payment', 'succeeded'],
      ['cancel_immediately', 'succeeded'],
      ['send_reply', 'succeeded'],
    ])
    expect(t.fakes.stripe.state.refunds.size).toBe(1)
    const refund = [...t.fakes.stripe.state.refunds.values()][0]!
    expect(refund).toMatchObject({
      amount: 1307,
      charge: 'ch_daniel',
      metadata: { maelle_ticket: '#4809', maelle_key: `${DANIEL}:v2:p0` },
    })
    expect(t.fakes.stripe.state.subscriptions.get('sub_1Qd2Ln')?.status).toBe('canceled')
    const rows = await t.executions(DANIEL)
    expect(rows).toHaveLength(4)
    const v2 = rows.filter((r) => String(r.idempotency_key).includes(':v2:'))
    expect(v2.map((r) => r.irreversible)).toEqual([true, true, false])
    expect(v2[0]!.external_refs).toMatchObject({
      stripeRefund: refund.id,
      stripeCharge: 'ch_daniel',
    })
    expect((await t.ticket('4809')).resolution).toBe('approved')
    expect(t.mail.sent.at(-1)).toMatchObject({
      to: 'd.okafor@proton.me',
      idempotencyKey: `${DANIEL}:v2:p2`,
    })

    await expect(
      t.executor.approve('4809', { ...input, confirmIrreversible: true }, 'you'),
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(t.fakes.stripe.state.refunds.size).toBe(1)
  })

  it('Marco #4822 stage 1: sends only the reply, queues the irreversible actions, waits for the customer', async () => {
    const refundsBefore = t.fakes.stripe.state.refunds.size
    const res = await t.executor.approve(
      '4822',
      { proposalVersion: 1, actions: t.allEnabled(3) },
      'you',
    )
    expect(res.ticketStatus).toBe('waiting_on_customer')
    expect(res.executions.map((e) => [e.type, e.status])).toEqual([
      ['refund_latest_payment', 'queued'],
      ['cancel_immediately', 'queued'],
      ['send_reply', 'succeeded'],
    ])
    const ticket = await t.ticket('4822')
    expect(ticket.status).toBe('waiting_on_customer')
    expect(ticket.waiting_for).toBe('Waiting for “Yes, refund”')
    expect(ticket.stage).toBe(1)
    const rows = await t.executions(MARCO)
    expect(rows.filter((r) => r.status === 'queued')).toHaveLength(2)
    expect(rows.find((r) => r.status === 'queued')?.result).toEqual({
      awaitingCustomerConfirmation: true,
    })
    expect(t.fakes.stripe.state.refunds.size).toBe(refundsBefore)
    expect(t.fakes.stripe.state.subscriptions.get('sub_1QfA7y')?.status).toBe('active')
    expect(t.mail.sent.at(-1)).toMatchObject({ to: 'marco.bianchi@libero.it' })
    await expect(t.executor.retry('4822')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('Priya #4820 retry: re-runs the failed required action as attempt 2 and releases the held reply', async () => {
    const before = await t.executions(PRIYA)
    expect(before.map((r) => r.status)).toEqual(['succeeded', 'failed', 'held'])
    const res = await t.executor.retry('4820')
    expect(res.ticketStatus).toBe('closed')
    expect(res.executions.map((e) => [e.type, e.status])).toEqual([
      ['store_release_notification_email', 'succeeded'],
      ['send_reply', 'succeeded'],
    ])
    const rows = await t.executions(PRIYA)
    expect(rows).toHaveLength(4)
    const attempt2 = rows.find((r) => Number(r.attempt) === 2)!
    expect(attempt2.idempotency_key).toBe(`${PRIYA}:v1:p1:a2`)
    expect(attempt2.status).toBe('succeeded')
    expect(rows.find((r) => r.idempotency_key === `${PRIYA}:v1:p1`)?.status).toBe('failed')
    const held = rows.find((r) => r.idempotency_key === `${PRIYA}:v1:p2`)!
    expect(held.id).toBe(before[2]!.id)
    expect(held.status).toBe('succeeded')
    const stored = await t.q('select * from public.release_notifications where ticket_id = $1', [
      PRIYA,
    ])
    expect(stored).toEqual([
      expect.objectContaining({
        linear_issue_identifier: 'INS-198',
        email: 'priya.nair@gmail.com',
      }),
    ])
    expect(t.mail.sent.at(-1)).toMatchObject({
      to: 'priya.nair@gmail.com',
      idempotencyKey: `${PRIYA}:v1:p2`,
    })
    // The Linear link had succeeded before, so it is not touched again.
    expect(t.fakes.linear.calls.filter((c) => c.op === 'createComment')).toHaveLength(0)
    expect((await t.ticket('4820')).resolution).toBe('approved')
    await expect(t.executor.retry('4820')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('records edits (reply diff, toggles, params) and skips disabled actions', async () => {
    t.fakes.stripe.seedCustomer({
      customer: 'cus_edit',
      subscription: 'sub_edit',
      paymentIntent: 'pi_edit',
      charge: 'ch_edit',
      amount: 799,
    })
    const { ticketId, reply } = await t.insertTicket({
      caseType: 'cancellation_only',
      stripeCustomerId: 'cus_edit',
      actions: [
        {
          type: 'cancel_at_period_end',
          params: { stripeSubscriptionId: 'sub_edit', accessUntil: '2026-10-14' },
        },
        { type: 'store_cancellation_reason', params: { feedback: 'other', comment: 'Not stated' } },
        { type: 'send_reply', params: { to: 'edit@example.com' } },
      ],
    })
    const res = await t.executor.approve(
      ticketId,
      {
        proposalVersion: 1,
        actions: [
          {
            position: 0,
            enabled: true,
            params: { stripeSubscriptionId: 'sub_edit', accessUntil: '2026-10-15' },
          },
          { position: 1, enabled: false },
          { position: 2, enabled: true },
        ],
        reply: { subject: reply!.subject, body: reply!.body.replace('Done.', 'All done, Tom.') },
      },
      'you',
    )
    expect(res.ticketStatus).toBe('closed')
    expect(res.executions.map((e) => e.type)).toEqual(['cancel_at_period_end', 'send_reply'])
    const [decision] = await t.decisions(ticketId)
    expect(decision!.decision).toBe('approved_with_edits')
    expect(decision!.reply_diff).toMatchObject({ added: 1, removed: 1, subject: null })
    expect(decision!.action_changes).toEqual([
      { position: 0, field: 'params.accessUntil', from: '2026-10-14', to: '2026-10-15' },
      { position: 1, field: 'enabled', from: true, to: false },
    ])
    expect((await t.ticket(ticketId)).resolution).toBe('approved_with_edits')
    expect(await t.executions(ticketId)).toHaveLength(2)
    expect(t.mail.sent.at(-1)).toMatchObject({ to: 'edit@example.com' })
  })

  it('holds the reply only while a required action failed; a retry never duplicates the Linear issue', async () => {
    const { ticketId, email } = await t.insertTicket({
      caseType: 'feature_request',
      actions: [
        {
          type: 'create_linear_ticket',
          params: {
            title: 'Weekly PDF report',
            description: 'Customer asks for a weekly PDF.',
            label: 'Feature',
            customerEmail: 'sofia@example.com',
          },
        },
        {
          type: 'store_release_notification_email',
          params: { fromActionPosition: 0, email: 'sofia@example.com' },
          requiredForReply: true,
        },
        { type: 'send_reply', params: { to: 'sofia@example.com' } },
      ],
      email: 'sofia@example.com',
    })
    t.fakes.linear.failNext(
      'createIssue',
      new ProviderError('Linear', 'Rate limited', {
        code: 'Ratelimited',
        statusCode: 429,
        retryable: true,
      }),
    )
    const issuesBefore = t.fakes.linear.state.issues.size
    const mailBefore = t.mail.sent.length
    const res = await t.executor.approve(
      ticketId,
      { proposalVersion: 1, actions: t.allEnabled(3) },
      'you',
    )
    expect(res.ticketStatus).toBe('action_failed')
    expect(res.executions.map((e) => [e.type, e.status])).toEqual([
      ['create_linear_ticket', 'failed'],
      ['store_release_notification_email', 'failed'],
      ['send_reply', 'held'],
    ])
    expect(res.executions[0]!.error).toBe(
      'Linear: Ratelimited: Rate limited (429) · the Linear issue was not created',
    )
    expect(res.executions[1]!.error).toBe(
      'Waiting on Create Linear ticket (action 1), which has not succeeded · the email was not stored',
    )
    expect(res.executions[2]!.result).toMatchObject({
      held: true,
      waitingOn: ['Store email for release notification'],
    })
    expect(t.mail.sent).toHaveLength(mailBefore)

    const retry = await t.executor.retry(ticketId)
    expect(retry.ticketStatus).toBe('closed')
    expect(retry.executions.map((e) => [e.type, e.status])).toEqual([
      ['create_linear_ticket', 'succeeded'],
      ['store_release_notification_email', 'succeeded'],
      ['send_reply', 'succeeded'],
    ])
    expect(t.fakes.linear.state.issues.size).toBe(issuesBefore + 1)
    const rows = await t.executions(ticketId)
    expect(rows).toHaveLength(5)
    expect(rows.filter((r) => Number(r.attempt) === 2).map((r) => r.action_type)).toEqual([
      'create_linear_ticket',
      'store_release_notification_email',
    ])
    expect(t.mail.sent.at(-1)).toMatchObject({ to: email, idempotencyKey: `${ticketId}:v1:p2` })
    expect((await t.ticket(ticketId)).resolution).toBe('approved')
  })

  it('still sends the reply when a non-required action fails, and retries only that action', async () => {
    t.fakes.stripe.seedCustomer({
      customer: 'cus_fail',
      subscription: 'sub_fail',
      paymentIntent: 'pi_fail',
      charge: 'ch_fail',
      amount: 799,
    })
    const { ticketId, email } = await t.insertTicket({
      caseType: 'cancellation_only',
      stripeCustomerId: 'cus_fail',
      actions: [
        { type: 'cancel_at_period_end', params: { stripeSubscriptionId: 'sub_fail' } },
        { type: 'store_cancellation_reason', params: { feedback: 'other', comment: 'Not stated' } },
        { type: 'send_reply', params: { to: 'fail@example.com' } },
      ],
      email: 'fail@example.com',
    })
    t.fakes.stripe.failNext({ op: 'updateSubscription', error: rateLimitError() })
    const res = await t.executor.approve(
      ticketId,
      { proposalVersion: 1, actions: t.allEnabled(3) },
      'you',
    )
    expect(res.ticketStatus).toBe('action_failed')
    expect(res.executions.map((e) => [e.type, e.status])).toEqual([
      ['cancel_at_period_end', 'failed'],
      ['store_cancellation_reason', 'succeeded'],
      ['send_reply', 'succeeded'],
    ])
    expect(res.executions[0]!.error).toBe(
      'Stripe: rate_limit: Too many requests (429) · the subscription was not changed · req_fake429',
    )
    const failedRow = (await t.executions(ticketId)).find((r) => r.status === 'failed')!
    expect(failedRow.external_refs).toEqual({ requestId: 'req_fake429', errorCode: 'rate_limit' })
    expect(t.mail.sent.at(-1)).toMatchObject({ to: email })
    const mailCount = t.mail.sent.length

    const retry = await t.executor.retry(ticketId)
    expect(retry.ticketStatus).toBe('closed')
    expect(retry.executions.map((e) => [e.type, e.status])).toEqual([
      ['cancel_at_period_end', 'succeeded'],
    ])
    expect(t.mail.sent).toHaveLength(mailCount)
    expect(t.fakes.stripe.state.subscriptions.get('sub_fail')?.cancelAtPeriodEnd).toBe(true)
  })

  it('reject makes the ticket manual; manual send runs the chosen actions and closes with the right resolution', async () => {
    t.fakes.stripe.seedCustomer({
      customer: 'cus_rej',
      subscription: 'sub_rej',
      paymentIntent: 'pi_rej',
      charge: 'ch_rej',
      amount: 799,
    })
    const a = await t.insertTicket({
      caseType: 'cancellation_only',
      stripeCustomerId: 'cus_rej',
      actions: [{ type: 'send_reply', params: { to: 'rej@example.com' } }],
      email: 'rej@example.com',
    })
    const rejected = await t.executor.rejectTicket(a.ticketId, 'wrong_tone', 'Too chatty')
    expect(rejected.ticketStatus).toBe('manual')
    expect(await t.proposalStatus(a.ticketId)).toMatchObject({ status: 'decided' })
    expect((await t.decisions(a.ticketId))[0]).toMatchObject({
      decision: 'rejected',
      reject_reason: 'wrong_tone',
      note: 'Too chatty',
    })
    await expect(t.executor.rejectTicket(a.ticketId, 'wrong_tone')).rejects.toMatchObject({
      statusCode: 409,
    })

    const sent = await t.executor.manualSend(a.ticketId, {
      reply: { to: 'rej@example.com', subject: 'Re: Test', body: 'Hi, I cancelled it for you.' },
      actions: [
        {
          type: 'store_cancellation_reason',
          params: {
            stripeSubscriptionId: 'sub_rej',
            feedback: 'too_expensive',
            comment: 'Too expensive',
          },
        },
      ],
      handledManually: false,
    })
    expect(sent.ticketStatus).toBe('closed')
    expect(sent.executions.map((e) => [e.type, e.status])).toEqual([
      ['store_cancellation_reason', 'succeeded'],
      ['send_reply', 'succeeded'],
    ])
    expect((await t.ticket(a.ticketId)).resolution).toBe('rejected')
    const rows = await t.executions(a.ticketId)
    expect(rows.map((r) => r.idempotency_key)).toEqual([
      `${a.ticketId}:m${sent.decisionId}:p0`,
      `${a.ticketId}:m${sent.decisionId}:p1`,
    ])
    expect((await t.decisions(a.ticketId)).map((d) => d.decision)).toEqual([
      'rejected',
      'handled_manually',
    ])
    expect(t.mail.sent.at(-1)).toMatchObject({ to: 'rej@example.com', subject: 'Re: Test' })

    const b = await t.insertTicket({
      caseType: 'outage_access',
      actions: [{ type: 'send_reply', params: { to: 'b@example.com' } }],
      email: 'b@example.com',
    })
    await t.executor.rejectTicket(b.ticketId, 'handle_myself')
    const sentB = await t.executor.manualSend(b.ticketId, {
      reply: { to: 'b@example.com', subject: 'Re: Test', body: 'Fixed now.' },
      actions: [],
      handledManually: true,
    })
    expect(sentB.ticketStatus).toBe('closed')
    expect((await t.ticket(b.ticketId)).resolution).toBe('handled_manually')
    await expect(
      t.executor.manualSend(b.ticketId, {
        reply: { to: 'b@example.com', subject: 's', body: 'b' },
        actions: [],
        handledManually: true,
      }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('manual send needs the confirm for irreversible actions and refuses em dashes', async () => {
    t.fakes.stripe.seedCustomer({
      customer: 'cus_man',
      subscription: 'sub_man',
      paymentIntent: 'pi_man',
      charge: 'ch_man',
      amount: 1307,
    })
    const c = await t.insertTicket({
      caseType: 'refund_request',
      stripeCustomerId: 'cus_man',
      actions: [{ type: 'send_reply', params: { to: 'man@example.com' } }],
      email: 'man@example.com',
    })
    const input = {
      reply: { to: 'man@example.com', subject: 'Re: Refund', body: 'Refunded.' },
      actions: [
        {
          type: 'refund_latest_payment' as const,
          params: { stripePaymentIntentId: 'pi_man', amountCents: 1307 },
        },
      ],
      handledManually: true,
    }
    await expect(t.executor.manualSend(c.ticketId, input)).rejects.toBeInstanceOf(
      ConfirmRequiredError,
    )
    await expect(
      t.executor.manualSend(c.ticketId, {
        ...input,
        reply: { ...input.reply, body: 'Refunded — done' },
        confirmIrreversible: true,
      }),
    ).rejects.toMatchObject({ statusCode: 400, data: { error: 'em_dash' } })
    expect((await t.ticket(c.ticketId)).status).toBe('needs_decision')
    const refunds = t.fakes.stripe.state.refunds.size
    const res = await t.executor.manualSend(c.ticketId, { ...input, confirmIrreversible: true })
    expect(res.ticketStatus).toBe('closed')
    expect(t.fakes.stripe.state.refunds.size).toBe(refunds + 1)
    expect((await t.ticket(c.ticketId)).resolution).toBe('handled_manually')
  })
})
