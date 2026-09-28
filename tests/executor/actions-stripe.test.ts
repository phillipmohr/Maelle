import { describe, expect, it } from 'vitest'
import { ACTION_HANDLERS } from '../../server/executor/actions'
import { ProviderError, PreconditionError } from '../../server/executor/errors'
import { rateLimitError } from '../../server/executor/clients/stripe-fake'
import { makeCtx, makeTicket } from './helpers'

const seedTom = (fakes: ReturnType<typeof makeCtx>['fakes']) =>
  fakes.stripe.seedCustomer({
    customer: 'cus_TBecker0203',
    subscription: 'sub_1PzT8c',
    paymentIntent: 'pi_tom',
    charge: 'ch_tom',
    amount: 799,
    currentPeriodEnd: Math.floor(Date.UTC(2026, 9, 14) / 1000),
  })

describe('cancel_at_period_end', () => {
  const h = ACTION_HANDLERS.cancel_at_period_end

  it('sets cancel_at_period_end with the idempotency key and returns the access end date', async () => {
    const { ctx, fakes } = makeCtx()
    seedTom(fakes)
    const out = await h.run({ stripeSubscriptionId: 'sub_1PzT8c' }, ctx)
    expect(out.result).toMatchObject({ cancelAtPeriodEnd: true, accessUntil: '2026-10-14' })
    expect(fakes.stripe.state.subscriptions.get('sub_1PzT8c')?.cancelAtPeriodEnd).toBe(true)
    const update = fakes.stripe.calls.find((c) => c.op === 'updateSubscription')
    expect(update?.idempotencyKey).toBe(ctx.idempotencyKey)
    // Already scheduled: no second write.
    const again = await h.run({ stripeSubscriptionId: 'sub_1PzT8c' }, ctx)
    expect(again.result).toMatchObject({ alreadyScheduled: true, accessUntil: '2026-10-14' })
    expect(fakes.stripe.calls.filter((c) => c.op === 'updateSubscription')).toHaveLength(1)
  })

  it('reports an already cancelled subscription instead of failing', async () => {
    const { ctx, fakes } = makeCtx()
    seedTom(fakes)
    fakes.stripe.state.subscriptions.get('sub_1PzT8c')!.status = 'canceled'
    const out = await h.run({ stripeSubscriptionId: 'sub_1PzT8c' }, ctx)
    expect(out.result).toMatchObject({ alreadyCancelled: true })
  })

  it('surfaces Stripe errors as ProviderError', async () => {
    const { ctx, fakes } = makeCtx()
    seedTom(fakes)
    fakes.stripe.failNext({ op: 'updateSubscription', error: rateLimitError() })
    await expect(h.run({ stripeSubscriptionId: 'sub_1PzT8c' }, ctx)).rejects.toBeInstanceOf(
      ProviderError,
    )
    await expect(h.run({ stripeSubscriptionId: 'nope' }, ctx)).rejects.toMatchObject({
      code: 'resource_missing',
    })
  })
})

describe('cancel_immediately', () => {
  it('cancels now, once, and does not touch InstaRadar data', async () => {
    const { ctx, fakes } = makeCtx()
    seedTom(fakes)
    const out = await ACTION_HANDLERS.cancel_immediately.run(
      { stripeSubscriptionId: 'sub_1PzT8c', profilesAffected: 2 },
      ctx,
    )
    expect(out.result).toMatchObject({ status: 'canceled', profilesAffected: 2 })
    expect(fakes.instaradar.calls).toEqual([])
    const again = await ACTION_HANDLERS.cancel_immediately.run(
      { stripeSubscriptionId: 'sub_1PzT8c' },
      ctx,
    )
    expect(again.result).toMatchObject({ alreadyCancelled: true })
    expect(fakes.stripe.calls.filter((c) => c.op === 'cancelSubscription')).toHaveLength(1)
  })
})

describe('refund_latest_payment', () => {
  const h = ACTION_HANDLERS.refund_latest_payment
  const params = {
    stripePaymentIntentId: 'pi_tom',
    amountCents: 799,
    currency: 'usd',
    reason: 'requested_by_customer' as const,
  }

  it('refunds the latest payment with metadata and the idempotency key', async () => {
    const { ctx, fakes } = makeCtx()
    seedTom(fakes)
    const out = await h.run(params, ctx)
    expect(out.result).toMatchObject({ amountCents: 799, chargeId: 'ch_tom', partial: false })
    expect(out.externalRefs?.stripeRefund).toMatch(/^re_/)
    const refund = [...fakes.stripe.state.refunds.values()][0]!
    expect(refund.metadata).toEqual({ maelle_ticket: '#4824', maelle_key: ctx.idempotencyKey })
    expect(fakes.stripe.calls.find((c) => c.op === 'createRefund')?.idempotencyKey).toBe(
      ctx.idempotencyKey,
    )
  })

  it('never refunds twice: a second run finds its own refund', async () => {
    const { ctx, fakes } = makeCtx()
    seedTom(fakes)
    const first = await h.run(params, ctx)
    const second = await h.run(params, { ...ctx, attempt: 2 })
    expect(second.result).toMatchObject({
      alreadyRefunded: true,
      refundId: (first.result as { refundId: string }).refundId,
    })
    expect(fakes.stripe.state.refunds.size).toBe(1)
    expect(fakes.stripe.calls.filter((c) => c.op === 'createRefund')).toHaveLength(1)
  })

  it('refuses when already refunded, when not the latest payment, or when the amount is too high', async () => {
    const { ctx, fakes } = makeCtx()
    seedTom(fakes)
    fakes.stripe.state.charges.get('ch_tom')!.amountRefunded = 799
    fakes.stripe.state.charges.get('ch_tom')!.refunded = true
    await expect(h.run(params, ctx)).rejects.toThrow(/already refunded/)
    fakes.stripe.state.charges.get('ch_tom')!.amountRefunded = 0
    fakes.stripe.state.charges.get('ch_tom')!.refunded = false
    fakes.stripe.addCharge({
      id: 'ch_newer',
      customer: 'cus_TBecker0203',
      amount: 799,
      amountRefunded: 0,
      refunded: false,
      paid: true,
      status: 'succeeded',
      paymentIntent: 'pi_newer',
      currency: 'usd',
      created: Math.floor(Date.now() / 1000),
    })
    await expect(h.run(params, ctx)).rejects.toThrow(/Not the latest payment: ch_newer/)
    fakes.stripe.state.charges.delete('ch_newer')
    await expect(h.run({ ...params, amountCents: 1000 }, ctx)).rejects.toThrow(
      /more than the payment/,
    )
    await expect(h.run({ ...params, currency: 'eur' }, ctx)).rejects.toThrow(/Currency mismatch/)
    expect(fakes.stripe.state.refunds.size).toBe(0)
  })

  it('enforces the daily count and amount limits from settings', async () => {
    const { ctx, fakes, store } = makeCtx()
    seedTom(fakes)
    store.state.refundsToday = { count: 3, amountCents: 0 }
    await expect(h.run(params, ctx)).rejects.toThrow(
      'Daily refund limit reached (3 of 3 refunds today)',
    )
    store.state.refundsToday = { count: 1, amountCents: 9_500 }
    await expect(h.run(params, ctx)).rejects.toThrow(/Daily refund amount limit reached/)
    expect(fakes.stripe.state.refunds.size).toBe(0)
  })

  it('accepts a charge id and allows partial refunds', async () => {
    const { ctx, fakes } = makeCtx()
    seedTom(fakes)
    const out = await h.run(
      { ...params, stripePaymentIntentId: undefined, stripeChargeId: 'ch_tom', amountCents: 300 },
      ctx,
    )
    expect(out.result).toMatchObject({ amountCents: 300, partial: true })
    expect(fakes.stripe.state.charges.get('ch_tom')?.amountRefunded).toBe(300)
  })

  it('passes Stripe failures through with the request id', async () => {
    const { ctx, fakes } = makeCtx()
    seedTom(fakes)
    fakes.stripe.failNext({ op: 'createRefund', error: rateLimitError('req_Qx91Lm') })
    await expect(h.run(params, ctx)).rejects.toMatchObject({
      code: 'rate_limit',
      requestId: 'req_Qx91Lm',
    })
    // The retry with the same key succeeds and creates exactly one refund.
    await h.run(params, { ...ctx, attempt: 2 })
    expect(fakes.stripe.state.refunds.size).toBe(1)
  })
})

describe('stop_failed_payment_retries', () => {
  const h = ACTION_HANDLERS.stop_failed_payment_retries

  it('marks open invoices uncollectible for a cancelled subscription', async () => {
    const { ctx, fakes } = makeCtx()
    seedTom(fakes)
    fakes.stripe.state.subscriptions.get('sub_1PzT8c')!.status = 'canceled'
    fakes.stripe.addInvoice({
      id: 'in_1',
      customer: 'cus_TBecker0203',
      subscription: 'sub_1PzT8c',
      status: 'open',
      autoAdvance: true,
      amountDue: 799,
      attemptCount: 3,
      number: 'A-1',
    })
    fakes.stripe.addInvoice({
      id: 'in_2',
      customer: 'cus_TBecker0203',
      subscription: 'sub_1PzT8c',
      status: 'paid',
      autoAdvance: false,
      amountDue: 0,
      attemptCount: 1,
      number: 'A-2',
    })
    const out = await h.run(
      {
        stripeCustomerId: 'cus_TBecker0203',
        stripeSubscriptionId: 'sub_1PzT8c',
        stripeInvoiceIds: [],
      },
      ctx,
    )
    expect(out.result).toMatchObject({ invoices: [{ id: 'in_1', action: 'marked_uncollectible' }] })
    expect(fakes.stripe.state.invoices.get('in_1')?.status).toBe('uncollectible')
    expect(fakes.stripe.state.invoices.get('in_1')?.autoAdvance).toBe(false)
  })

  it('refuses for an active subscription and falls back to auto-advance off', async () => {
    const { ctx, fakes } = makeCtx()
    seedTom(fakes)
    await expect(
      h.run(
        {
          stripeCustomerId: 'cus_TBecker0203',
          stripeSubscriptionId: 'sub_1PzT8c',
          stripeInvoiceIds: [],
        },
        ctx,
      ),
    ).rejects.toBeInstanceOf(PreconditionError)
    fakes.stripe.addInvoice({
      id: 'in_3',
      customer: 'cus_TBecker0203',
      subscription: null,
      status: 'open',
      autoAdvance: true,
      amountDue: 799,
      attemptCount: 2,
      number: null,
    })
    fakes.stripe.failNext({
      op: 'markInvoiceUncollectible',
      error: new ProviderError('Stripe', 'cannot mark', {
        code: 'invoice_not_open',
        statusCode: 400,
      }),
    })
    const out = await h.run(
      { stripeCustomerId: 'cus_TBecker0203', stripeInvoiceIds: ['in_3'] },
      ctx,
    )
    expect(out.result).toMatchObject({ invoices: [{ id: 'in_3', action: 'auto_advance_off' }] })
    expect(fakes.stripe.state.invoices.get('in_3')?.autoAdvance).toBe(false)
    const none = await h.run({ stripeCustomerId: 'cus_nobody', stripeInvoiceIds: [] }, ctx)
    expect(none.result).toMatchObject({ invoices: [], note: 'No open invoices, nothing to stop' })
  })
})

describe('create_coupon', () => {
  const h = ACTION_HANDLERS.create_coupon

  it('applies a percent coupon to the subscription', async () => {
    const { ctx, fakes } = makeCtx()
    seedTom(fakes)
    const out = await h.run(
      {
        kind: 'percent',
        percentOff: 20,
        duration: 'once',
        applyTo: 'subscription',
        stripeSubscriptionId: 'sub_1PzT8c',
      },
      ctx,
    )
    expect(out.result).toMatchObject({
      percentOff: 20,
      appliedTo: 'sub_1PzT8c',
      name: 'Goodwill · Maelle #4824',
    })
    expect(fakes.stripe.state.subscriptions.get('sub_1PzT8c')?.discounts).toHaveLength(1)
    // Same key twice: Stripe replays, no second coupon.
    await h.run(
      {
        kind: 'percent',
        percentOff: 20,
        duration: 'once',
        applyTo: 'subscription',
        stripeSubscriptionId: 'sub_1PzT8c',
      },
      ctx,
    )
    expect(fakes.stripe.state.coupons.size).toBe(1)
    expect(fakes.stripe.state.subscriptions.get('sub_1PzT8c')?.discounts).toHaveLength(1)
  })

  it('hands out a one-use promotion code and validates the kind', async () => {
    const { ctx, fakes } = makeCtx()
    seedTom(fakes)
    const out = await h.run(
      {
        kind: 'amount',
        amountOffCents: 500,
        currency: 'usd',
        duration: 'once',
        applyTo: 'promotion_code',
      },
      ctx,
    )
    expect((out.result as { promotionCode: string }).promotionCode).toMatch(/^IR-[0-9A-F]{6}$/)
    expect(fakes.stripe.state.promotionCodes.size).toBe(1)
    await expect(
      h.run({ kind: 'percent', duration: 'once', applyTo: 'subscription' }, ctx),
    ).rejects.toThrow(/percentOff/)
    await expect(
      h.run(
        { kind: 'percent', percentOff: 10, duration: 'repeating', applyTo: 'promotion_code' },
        ctx,
      ),
    ).rejects.toThrow(/durationInMonths/)
  })

  it('finds the active subscription from the customer when no id is given', async () => {
    const { ctx, fakes } = makeCtx({ ticket: makeTicket({ stripeCustomerId: 'cus_TBecker0203' }) })
    seedTom(fakes)
    const out = await h.run(
      { kind: 'percent', percentOff: 15, duration: 'once', applyTo: 'subscription' },
      ctx,
    )
    expect(out.result).toMatchObject({ appliedTo: 'sub_1PzT8c' })
  })
})
