import { describe, expect, it } from 'vitest'
import { ACTION_HANDLERS } from '../../server/executor/actions'
import { PreconditionError, ProviderError } from '../../server/executor/errors'
import { makeCtx, makeProposal, makeTicket, REPLY } from './helpers'

describe('create_linear_ticket', () => {
  const h = ACTION_HANDLERS.create_linear_ticket
  const params = {
    title: 'Date and time in file names',
    description: 'Customer report from liam.chen@icloud.com: files are all media.mp4.',
    label: 'Feature' as const,
    customerEmail: 'liam.chen@icloud.com',
  }

  it('creates the issue with the marker and the notify line, never twice', async () => {
    const { ctx, fakes } = makeCtx()
    const out = await h.run(params, ctx)
    expect(out.result).toMatchObject({ created: true, identifier: 'INS-300', label: 'Feature' })
    const issue = fakes.linear.state.issues.get('INS-300')!
    expect(issue.description).toContain('Customer to notify once released: liam.chen@icloud.com')
    expect(issue.description).toContain('Maelle ticket #4824')
    expect(issue.label).toBe('Feature')
    const again = await h.run(params, { ...ctx, attempt: 2 })
    expect(again.result).toMatchObject({ identifier: 'INS-300', alreadyCreated: true })
    expect(fakes.linear.state.issues.size).toBe(1)
  })

  it('links an existing issue with one comment carrying the notify line', async () => {
    const { ctx, fakes } = makeCtx()
    fakes.linear.addIssue({ identifier: 'INS-198', title: 'False post deleted alerts' })
    const p = {
      ...params,
      existingIssueIdentifier: 'INS-198',
      customerEmail: 'priya.nair@gmail.com',
    }
    const out = await h.run(p, ctx)
    expect(out.result).toMatchObject({ linked: true, identifier: 'INS-198' })
    expect(out.externalRefs).toMatchObject({ linearIssue: 'INS-198' })
    const comments = fakes.linear.state.issues.get('INS-198')!.comments
    expect(comments).toHaveLength(1)
    expect(comments[0]!.body).toContain('Customer to notify once released: priya.nair@gmail.com')
    const again = await h.run(p, { ...ctx, attempt: 2 })
    expect(again.result).toMatchObject({ alreadyLinked: true, commentId: comments[0]!.id })
    expect(fakes.linear.state.issues.get('INS-198')!.comments).toHaveLength(1)
    await expect(h.run({ ...p, existingIssueIdentifier: 'INS-999' }, ctx)).rejects.toBeInstanceOf(
      PreconditionError,
    )
  })
})

describe('store_release_notification_email', () => {
  const h = ACTION_HANDLERS.store_release_notification_email

  it('stores once per (issue, email), from the identifier or the prior Linear result', async () => {
    const { ctx, store } = makeCtx()
    const a = await h.run({ linearIssueIdentifier: 'INS-198', email: 'priya.nair@gmail.com' }, ctx)
    expect(a.result).toMatchObject({ identifier: 'INS-198', alreadyStored: false })
    const b = await h.run({ linearIssueIdentifier: 'INS-198', email: 'Priya.Nair@gmail.com' }, ctx)
    expect(b.result).toMatchObject({ alreadyStored: true })
    expect(store.state.releaseNotifications).toHaveLength(1)
    ctx.priorResults.set(0, { identifier: 'INS-300', id: 'lin_ins-300' })
    const c = await h.run({ fromActionPosition: 0, email: 'liam.chen@icloud.com' }, ctx)
    expect(c.result).toMatchObject({ identifier: 'INS-300' })
    expect(store.state.releaseNotifications[1]).toMatchObject({
      linearIssueId: 'lin_ins-300',
      appId: 'app-1',
    })
    await expect(h.run({ fromActionPosition: 5, email: 'x@y.co' }, ctx)).rejects.toThrow(
      /Waiting on Create Linear ticket/,
    )
  })

  it('surfaces a store timeout like the design', async () => {
    const { ctx, store } = makeCtx()
    store.failNext(
      'insertReleaseNotification',
      new ProviderError('Supabase', 'insert into release_notify timed out after 10s', {
        code: null,
        requestId: 'req_8d1e42',
        retryable: true,
      }),
    )
    await expect(
      h.run({ linearIssueIdentifier: 'INS-198', email: 'p@x.co' }, ctx),
    ).rejects.toMatchObject({ requestId: 'req_8d1e42' })
  })
})

describe('store_cancellation_reason', () => {
  const h = ACTION_HANDLERS.store_cancellation_reason

  it('stores the reason in Maelle and on the Stripe subscription', async () => {
    const { ctx, fakes, store } = makeCtx()
    fakes.stripe.seedCustomer({
      customer: 'cus_TBecker0203',
      subscription: 'sub_1PzT8c',
      paymentIntent: 'pi',
      charge: 'ch',
      amount: 799,
    })
    const out = await h.run(
      { stripeSubscriptionId: 'sub_1PzT8c', feedback: 'too_expensive', comment: 'Too expensive' },
      ctx,
    )
    expect(out.result).toMatchObject({
      storedInMaelle: true,
      stripeUpdated: true,
      alreadyStored: false,
    })
    expect(store.state.cancellationReasons[0]).toMatchObject({
      customerEmail: 'tom.becker@web.de',
      stripeCustomerId: 'cus_TBecker0203',
      verbatimReason: 'Too expensive',
    })
    expect(fakes.stripe.state.subscriptions.get('sub_1PzT8c')?.cancellationDetails).toEqual({
      feedback: 'too_expensive',
      comment: 'Too expensive',
    })
    const again = await h.run(
      { stripeSubscriptionId: 'sub_1PzT8c', feedback: 'too_expensive', comment: 'Too expensive' },
      ctx,
    )
    expect(again.result).toMatchObject({ alreadyStored: true })
    expect(store.state.cancellationReasons).toHaveLength(1)
  })

  it('keeps the Maelle row when the subscription is already cancelled or unknown', async () => {
    const { ctx, fakes } = makeCtx()
    fakes.stripe.seedCustomer({
      customer: 'c',
      subscription: 'sub_c',
      paymentIntent: 'pi',
      charge: 'ch',
      amount: 1,
      status: 'canceled',
    })
    const out = await h.run(
      { stripeSubscriptionId: 'sub_c', feedback: 'other', comment: 'Not stated' },
      ctx,
    )
    expect(out.result).toMatchObject({
      stripeUpdated: false,
      stripeNote: expect.stringContaining('already cancelled'),
    })
    const none = await h.run({ feedback: 'other', comment: 'Not stated' }, ctx)
    expect(none.result).toMatchObject({ stripeUpdated: false })
  })
})

describe('remove_from_tracking', () => {
  it('blocks the profile for everyone and stops existing tracking', async () => {
    const { ctx, fakes } = makeCtx()
    fakes.instaradar.track('@Studio.Kolo', 'usr_a')
    fakes.instaradar.track('studio.kolo', 'usr_b')
    fakes.instaradar.track('other', 'usr_a')
    const out = await ACTION_HANDLERS.remove_from_tracking.run(
      { instagramHandle: 'studio.kolo', reason: 'threats' },
      ctx,
    )
    expect(out.result).toMatchObject({
      handle: 'studio.kolo',
      alreadyBlocked: false,
      trackingStopped: 2,
      blockedForViewing: true,
    })
    expect(fakes.instaradar.state.blocked.get('studio.kolo')).toEqual({
      reason: 'threats',
      source: 'Maelle ticket #4824',
    })
    const again = await ACTION_HANDLERS.remove_from_tracking.run(
      { instagramHandle: 'studio.kolo', reason: 'threats' },
      ctx,
    )
    expect(again.result).toMatchObject({ alreadyBlocked: true, trackingStopped: 0 })
  })
})

describe('delete_account', () => {
  const h = ACTION_HANDLERS.delete_account
  const params = { instaradarUserId: 'usr_dokafor_44b2', email: 'd.okafor@proton.me' }
  const ticket = makeTicket({
    stripeCustomerId: 'cus_DOkafor2291',
    instaradarUserId: 'usr_dokafor_44b2',
    customerEmail: 'd.okafor@proton.me',
  })

  it('needs the explicit customer confirmation and no active subscription', async () => {
    const { ctx, fakes } = makeCtx({ ticket })
    fakes.instaradar.addUser('usr_dokafor_44b2')
    fakes.authAdmin.addUser('usr_dokafor_44b2', 'd.okafor@proton.me')
    await expect(h.run(params, ctx)).rejects.toThrow(/explicit confirmation/)
    fakes.stripe.seedCustomer({
      customer: 'cus_DOkafor2291',
      subscription: 'sub_1Qd2Ln',
      paymentIntent: 'pi',
      charge: 'ch',
      amount: 1307,
    })
    await expect(h.run(params, { ...ctx, customerConfirmed: true })).rejects.toThrow(
      /active subscription \(sub_1Qd2Ln\)/,
    )
    expect(fakes.instaradar.state.users.has('usr_dokafor_44b2')).toBe(true)
    expect(fakes.authAdmin.state.users.has('usr_dokafor_44b2')).toBe(true)
  })

  it('deletes rows and the auth user once the subscription is cancelled; a retry finishes a partial run', async () => {
    const { ctx, fakes } = makeCtx({ ticket, customerConfirmed: true })
    fakes.instaradar.addUser('usr_dokafor_44b2', { tracked_profiles: 2, profiles: 1 })
    fakes.authAdmin.addUser('usr_dokafor_44b2', 'd.okafor@proton.me')
    fakes.stripe.seedCustomer({
      customer: 'cus_DOkafor2291',
      subscription: 'sub_1Qd2Ln',
      paymentIntent: 'pi',
      charge: 'ch',
      amount: 1307,
      status: 'canceled',
    })
    fakes.authAdmin.failNext(
      'deleteUser',
      new ProviderError('Supabase', 'gateway timeout', { statusCode: 504, retryable: true }),
    )
    await expect(h.run(params, ctx)).rejects.toMatchObject({ statusCode: 504 })
    expect(fakes.instaradar.state.users.has('usr_dokafor_44b2')).toBe(false)
    expect(fakes.authAdmin.state.users.has('usr_dokafor_44b2')).toBe(true)
    const out = await h.run(params, { ...ctx, attempt: 2 })
    expect(out.result).toMatchObject({
      authUserDeleted: true,
      deletedRows: {},
      subscriptionCheck: '1 subscription checked, none active',
    })
    expect(fakes.authAdmin.state.users.has('usr_dokafor_44b2')).toBe(false)
    const third = await h.run(params, { ...ctx, attempt: 3 })
    expect(third.result).toMatchObject({ alreadyDeleted: true })
  })

  it('refuses an unknown account on the first attempt and an email mismatch', async () => {
    const { ctx, fakes } = makeCtx({
      ticket: makeTicket({ stripeCustomerId: null }),
      customerConfirmed: true,
    })
    await expect(h.run(params, ctx)).rejects.toThrow(/No InstaRadar account found/)
    fakes.authAdmin.addUser('usr_dokafor_44b2', 'someone.else@example.com')
    await expect(h.run(params, ctx)).rejects.toThrow(/belongs to someone.else@example.com/)
  })
})

describe('send_reply', () => {
  const h = ACTION_HANDLERS.send_reply

  it('sends through mail.sendReply with the idempotency key and the executor identity', async () => {
    const { ctx, mail } = makeCtx({ executedBy: 'auto' })
    const out = await h.run({ to: 'tom.becker@web.de', cc: [], includeAttachments: true }, ctx)
    expect(out.result).toMatchObject({
      to: 'tom.becker@web.de',
      messageId: 'msg_1',
      attachments: 0,
    })
    expect(mail.sent[0]).toMatchObject({
      to: 'tom.becker@web.de',
      sentBy: 'auto',
      idempotencyKey: ctx.idempotencyKey,
    })
  })

  it('refuses em dashes and a missing draft, and wraps mail failures', async () => {
    const { ctx, mail } = makeCtx()
    await expect(
      h.run(
        { to: 'a@b.co', cc: [], includeAttachments: false },
        { ...ctx, replyDraft: { ...REPLY, body: 'Hi — there' } },
      ),
    ).rejects.toBeInstanceOf(PreconditionError)
    await expect(
      h.run(
        { to: 'a@b.co', cc: [], includeAttachments: false },
        { ...ctx, replyDraft: null, proposal: makeProposal({ replyDraft: null }) },
      ),
    ).rejects.toThrow(/no reply draft/)
    mail.failNext = new Error('SMTP 421 try later')
    await expect(
      h.run({ to: 'a@b.co', cc: [], includeAttachments: false }, ctx),
    ).rejects.toMatchObject({ provider: 'Mail', retryable: true })
  })
})
