/**
 * Snooze, mark done, case override, Auto (runAuto, undo, runDueScheduled) and the refund limits,
 * against the real schema (pnpm test:db) with the in-memory fakes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

describe.skipIf(!TEST_URL)('executor parking, Auto and limits', () => {
  let t: ExecutorTest

  beforeAll(async () => {
    t = await setupExecutorTest('auto')
  })
  afterAll(async () => {
    await t?.teardown()
  })

  it('snoozes and unsnoozes Jonas #4819; refuses past dates and safety tickets', async () => {
    const until = new Date(t.clock.now.getTime() + 24 * 3_600_000)
    const res = await t.executor.snoozeTicket('4819', until)
    expect(res).toEqual({ ticketStatus: 'snoozed', snoozedUntil: until.toISOString() })
    const snoozed = await t.ticket('4819')
    expect(snoozed.status).toBe('snoozed')
    expect(new Date(snoozed.snoozed_until as string).toISOString()).toBe(until.toISOString())
    const decisions = await t.decisions(snoozed.id as string)
    expect(decisions.at(-1)).toMatchObject({ decision: 'snoozed' })
    await expect(t.executor.snoozeTicket('4819', until)).rejects.toMatchObject({ statusCode: 409 })
    expect(await t.executor.unsnoozeTicket('4819')).toEqual({ ticketStatus: 'needs_decision' })
    expect((await t.ticket('4819')).snoozed_until).toBeNull()
    await expect(
      t.executor.snoozeTicket('4819', new Date(t.clock.now.getTime() - 1000)),
    ).rejects.toMatchObject({ statusCode: 400 })

    const safety = await t.insertTicket({
      caseType: 'safety_removal',
      risk: 'safety',
      actions: [
        { type: 'remove_from_tracking', params: { instagramHandle: 'someone', reason: 'threats' } },
        { type: 'send_reply', params: { to: 'safe@example.com' } },
      ],
      email: 'safe@example.com',
    })
    await expect(t.executor.snoozeTicket(safety.ticketId, until)).rejects.toMatchObject({
      statusCode: 422,
    })
    expect((await t.executor.runAuto(safety.ticketId)).refused).toBe('Risk level is safety')
    const res2 = await t.executor.approve(
      safety.ticketId,
      { proposalVersion: 1, actions: t.allEnabled(2) },
      'you',
    )
    expect(res2.ticketStatus).toBe('closed')
    expect(t.fakes.instaradar.state.blocked.has('someone')).toBe(true)
  })

  it('mark done needs a note, closes a failed ticket and cancels the held reply', async () => {
    const { ticketId } = await t.insertTicket({
      caseType: 'feature_request',
      email: 'done@example.com',
      actions: [
        {
          type: 'store_release_notification_email',
          params: { linearIssueIdentifier: 'INS-1', email: 'done@example.com' },
          requiredForReply: true,
        },
        { type: 'send_reply', params: { to: 'done@example.com' } },
      ],
    })
    // The store insert fails on a foreign key: no app row for a bogus id is not possible, so use a Linear dependency failure instead.
    await t.q(
      'update public.proposed_actions set params = $2 where proposal_id = (select id from public.proposals where ticket_id = $1) and position = 0',
      [ticketId, JSON.stringify({ fromActionPosition: 5, email: 'done@example.com' })],
    )
    const res = await t.executor.approve(
      ticketId,
      { proposalVersion: 1, actions: t.allEnabled(2) },
      'you',
    )
    expect(res.ticketStatus).toBe('action_failed')
    await expect(t.executor.markDoneTicket(ticketId, '  ')).rejects.toMatchObject({
      statusCode: 400,
    })
    const done = await t.executor.markDoneTicket(ticketId, 'Stored the email by hand')
    expect(done).toEqual({ ticketStatus: 'closed', resolution: 'marked_done' })
    const ticket = await t.ticket(ticketId)
    expect(ticket.resolution).toBe('marked_done')
    const rows = await t.executions(ticketId)
    expect(rows.find((r) => r.action_type === 'send_reply')?.status).toBe('cancelled')
    expect((await t.decisions(ticketId)).at(-1)).toMatchObject({
      decision: 'marked_done',
      note: 'Stored the email by hand',
    })
    await expect(t.executor.markDoneTicket(ticketId, 'again')).rejects.toMatchObject({
      statusCode: 409,
    })
  })

  it('case override stores the case, moves the ticket to researching and enqueues a case_override run', async () => {
    const { ticketId } = await t.insertTicket({ caseType: 'unclear', actions: [], reply: null })
    await expect(t.executor.setCaseAndEnqueue(ticketId, 'unclear')).rejects.toMatchObject({
      statusCode: 400,
    })
    const res = await t.executor.setCaseAndEnqueue(ticketId, 'billing_question')
    expect(res).toMatchObject({ ticketStatus: 'researching', caseType: 'billing_question' })
    const ticket = await t.ticket(ticketId)
    expect(ticket.case_type).toBe('billing_question')
    expect(Number(ticket.case_confidence)).toBe(1)
    expect(t.jobs.queue.at(-1)).toMatchObject({
      handle: { id: res.jobId, type: 'agent_run' },
      payload: { ticketId, trigger: 'case_override' },
    })
    await expect(
      t.executor.approve(ticketId, { proposalVersion: 1, actions: [] }, 'you'),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('runAuto refuses paused, high risk, unclear, policy warnings, pending confirmation and locked actions', async () => {
    expect(await t.executor.runAuto('4825')).toEqual({ ran: false, refused: 'Risk level is high' })
    const unclear = await t.insertTicket({ caseType: 'unclear', actions: [], reply: null })
    expect((await t.executor.runAuto(unclear.ticketId)).refused).toBe('Case is unclear')
    const warned = await t.insertTicket({
      ...featureSpec('warn@example.com'),
      policyWarnings: ['Second refund without a reason'],
    })
    expect((await t.executor.runAuto(warned.ticketId)).refused).toBe(
      'Policy warnings: Second refund without a reason',
    )
    const stage1 = await t.insertTicket({
      caseType: 'refund_request',
      confirmationNeeded: true,
      email: 's1@example.com',
      actions: [
        {
          type: 'refund_latest_payment',
          params: { stripePaymentIntentId: 'pi_s1', amountCents: 1307 },
          stage: 'after_confirmation',
        },
        { type: 'send_reply', params: { to: 's1@example.com' } },
      ],
    })
    expect((await t.executor.runAuto(stage1.ticketId)).refused).toBe(
      'Customer confirmation pending',
    )
    const locked = await t.insertTicket({
      caseType: 'refund_request',
      stage: 2,
      email: 'lock@example.com',
      actions: [
        {
          type: 'refund_latest_payment',
          params: { stripePaymentIntentId: 'pi_lock', amountCents: 1307 },
        },
        { type: 'cancel_immediately', params: { stripeSubscriptionId: 'sub_lock' } },
        { type: 'send_reply', params: { to: 'lock@example.com' } },
      ],
    })
    expect((await t.executor.runAuto(locked.ticketId)).refused).toBe(
      'Locked for Auto: Refund latest payment, Cancel immediately',
    )
    expect(t.fakes.stripe.state.refunds.size).toBe(0)
    await t.q('update public.settings set global_pause = true where app_id = $1', [t.appId])
    const feature = await t.insertTicket(featureSpec('paused@example.com'))
    expect((await t.executor.runAuto(feature.ticketId)).refused).toBe('Global pause is on')
    await t.q('update public.settings set global_pause = false where app_id = $1', [t.appId])
    expect((await t.ticket(feature.ticketId)).status).toBe('needs_decision')
    expect(await t.executions(feature.ticketId)).toEqual([])
  })

  it('runAuto runs a feature request: actions now, the reply scheduled after the undo window, ticket auto_pending', async () => {
    const { ticketId } = await t.insertTicket(featureSpec('auto@example.com'))
    const mailBefore = t.mail.sent.length
    const res = await t.executor.runAuto(ticketId)
    expect(res.ran).toBe(true)
    expect(res.executions?.map((e) => [e.type, e.status])).toEqual([
      ['create_linear_ticket', 'succeeded'],
      ['store_release_notification_email', 'succeeded'],
      ['send_reply', 'scheduled'],
    ])
    const ticket = await t.ticket(ticketId)
    expect(ticket.status).toBe('auto_pending')
    const rows = await t.executions(ticketId)
    expect(rows.every((r) => r.executed_by === 'auto')).toBe(true)
    const reply = rows.find((r) => r.action_type === 'send_reply')!
    expect(new Date(reply.scheduled_for as string).getTime()).toBe(
      t.clock.now.getTime() + 10 * 60_000,
    )
    expect((await t.decisions(ticketId))[0]).toMatchObject({ decision: 'auto' })
    expect(t.mail.sent).toHaveLength(mailBefore)
    expect(await t.proposalStatus(ticketId)).toMatchObject({ status: 'decided' })

    // Undo inside the window: the reply is cancelled, the ticket comes back, what ran is listed.
    const undo = await t.executor.undo(ticketId)
    expect(undo.cancelled.map((e) => [e.type, e.status])).toEqual([['send_reply', 'cancelled']])
    expect(undo.alreadyRan.map((e) => e.type)).toEqual([
      'create_linear_ticket',
      'store_release_notification_email',
    ])
    expect((await t.ticket(ticketId)).status).toBe('needs_decision')
    expect(await t.proposalStatus(ticketId)).toMatchObject({ status: 'active' })
    const cancelled = (await t.executions(ticketId)).find((r) => r.action_type === 'send_reply')!
    expect(cancelled.result).toMatchObject({
      undone: true,
      alreadyRan: ['Create Linear ticket', 'Store email for release notification'],
    })
    await expect(t.executor.undo(ticketId)).rejects.toMatchObject({ statusCode: 409 })

    // Approving again sends the reply (attempt 2) and never re-creates the Linear issue.
    const issues = t.fakes.linear.state.issues.size
    const again = await t.executor.approve(
      ticketId,
      { proposalVersion: 1, actions: t.allEnabled(3) },
      'you',
    )
    expect(again.ticketStatus).toBe('closed')
    expect(again.executions.map((e) => [e.type, e.status])).toEqual([
      ['create_linear_ticket', 'succeeded'],
      ['store_release_notification_email', 'succeeded'],
      ['send_reply', 'succeeded'],
    ])
    expect(t.fakes.linear.state.issues.size).toBe(issues)
    expect(t.mail.sent).toHaveLength(mailBefore + 1)
    expect(t.mail.sent.at(-1)).toMatchObject({
      to: 'auto@example.com',
      sentBy: 'you',
      idempotencyKey: `${ticketId}:v1:p2`,
    })
    const final = await t.executions(ticketId)
    expect(final).toHaveLength(4)
    expect(final.at(-1)).toMatchObject({
      idempotency_key: `${ticketId}:v1:p2:a2`,
      attempt: 2,
      status: 'succeeded',
      executed_by: 'you',
    })
    expect((await t.ticket(ticketId)).resolution).toBe('approved')
  })

  it('runDueScheduled sends due Auto replies and closes their tickets, not before their time', async () => {
    const { ticketId } = await t.insertTicket(featureSpec('due@example.com'))
    const t0 = t.clock.now
    const res = await t.executor.runAuto(ticketId)
    expect(res.ran).toBe(true)
    const mailBefore = t.mail.sent.length
    expect(await t.executor.runDueScheduled()).toEqual({ ran: 0 })
    t.clock.now = new Date(t0.getTime() + 11 * 60_000)
    expect(await t.executor.runDueScheduled()).toEqual({ ran: 1 })
    expect(t.mail.sent).toHaveLength(mailBefore + 1)
    expect(t.mail.sent.at(-1)).toMatchObject({
      to: 'due@example.com',
      sentBy: 'auto',
      idempotencyKey: `${ticketId}:v1:p2`,
    })
    const ticket = await t.ticket(ticketId)
    expect(ticket.status).toBe('closed')
    expect(ticket.resolution).toBe('auto')
    expect((await t.executions(ticketId)).find((r) => r.action_type === 'send_reply')?.status).toBe(
      'succeeded',
    )
    expect(await t.executor.runDueScheduled()).toEqual({ ran: 0 })
    await expect(t.executor.undo(ticketId)).rejects.toMatchObject({ statusCode: 409 })
    t.clock.now = t0
  })

  it('a failed scheduled send brings the ticket back to the inbox with the proposal active', async () => {
    const { ticketId } = await t.insertTicket(featureSpec('smtp@example.com'))
    const t0 = t.clock.now
    await t.executor.runAuto(ticketId)
    t.mail.failNext = new Error('SMTP 421 service not available')
    t.clock.now = new Date(t0.getTime() + 15 * 60_000)
    expect(await t.executor.runDueScheduled()).toEqual({ ran: 1 })
    const row = (await t.executions(ticketId)).find((r) => r.action_type === 'send_reply')!
    expect(row.status).toBe('failed')
    expect(row.error).toBe('Mail: SMTP 421 service not available · the reply was not sent')
    expect((await t.ticket(ticketId)).status).toBe('needs_decision')
    expect(await t.proposalStatus(ticketId)).toMatchObject({ status: 'active' })
    const again = await t.executor.approve(
      ticketId,
      { proposalVersion: 1, actions: t.allEnabled(3) },
      'you',
    )
    expect(again.ticketStatus).toBe('closed')
    expect(again.executions.at(-1)).toMatchObject({ type: 'send_reply', status: 'succeeded' })
    t.clock.now = t0
  })

  it("refund limits come from settings and count today's succeeded refunds", async () => {
    const mk = async (n: string) => {
      t.fakes.stripe.seedCustomer({
        customer: `cus_${n}`,
        subscription: `sub_${n}`,
        paymentIntent: `pi_${n}`,
        charge: `ch_${n}`,
        amount: 1307,
      })
      return t.insertTicket({
        caseType: 'refund_request',
        stage: 2,
        stripeCustomerId: `cus_${n}`,
        email: `${n}@example.com`,
        actions: [
          {
            type: 'refund_latest_payment',
            params: {
              stripePaymentIntentId: `pi_${n}`,
              amountCents: 1307,
              cardLabel: 'Visa ··0001',
            },
          },
          { type: 'send_reply', params: { to: `${n}@example.com` } },
        ],
      })
    }
    await t.q(
      'update public.settings set refund_daily_limit_count = 1, refund_daily_limit_amount_cents = 10000 where app_id = $1',
      [t.appId],
    )
    const x = await mk('x')
    const y = await mk('y')
    const input = { proposalVersion: 1, actions: t.allEnabled(2), confirmIrreversible: true }
    expect((await t.executor.approve(x.ticketId, input, 'you')).ticketStatus).toBe('closed')
    const res = await t.executor.approve(y.ticketId, input, 'you')
    expect(res.ticketStatus).toBe('action_failed')
    expect(res.executions[0]).toMatchObject({
      type: 'refund_latest_payment',
      status: 'failed',
      error: 'Daily refund limit reached (1 of 1 refunds today) · nothing was charged or refunded',
    })
    expect(t.fakes.stripe.state.refunds.size).toBe(1)
    await t.q(
      'update public.settings set refund_daily_limit_count = 3, refund_daily_limit_amount_cents = 2000 where app_id = $1',
      [t.appId],
    )
    const res2 = await t.executor.retry(y.ticketId)
    expect(res2.ticketStatus).toBe('action_failed')
    expect(res2.executions[0]!.error).toMatch(
      /^Daily refund amount limit reached \(\$13\.07 of \$20\.00 refunded today, this refund is \$13\.07\)/,
    )
    await t.q(
      'update public.settings set refund_daily_limit_count = 3, refund_daily_limit_amount_cents = 10000 where app_id = $1',
      [t.appId],
    )
    const res3 = await t.executor.retry(y.ticketId)
    expect(res3.ticketStatus).toBe('closed')
    expect(t.fakes.stripe.state.refunds.size).toBe(2)
    expect(
      (await t.executions(y.ticketId))
        .filter((r) => r.action_type === 'refund_latest_payment')
        .map((r) => Number(r.attempt)),
    ).toEqual([1, 2, 3])
  })
})
