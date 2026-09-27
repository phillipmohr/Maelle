import { deterministicUuid } from '#shared/utils/ids'
import { PreconditionError } from '../errors'
import type { ActionHandler } from '../types'

/** Percent or amount off; applied to the subscription or handed out as a one-use promotion code. */
export const createCoupon: ActionHandler<'create_coupon'> = {
  type: 'create_coupon',
  consequence: 'no coupon was created',
  async run(params, ctx) {
    const { stripe } = ctx.clients
    if (params.kind === 'percent' && params.percentOff == null) {
      throw new PreconditionError('A percent coupon needs percentOff')
    }
    if (params.kind === 'amount' && (params.amountOffCents == null || !params.currency)) {
      throw new PreconditionError('An amount coupon needs amountOffCents and currency')
    }
    if (params.duration === 'repeating' && params.durationInMonths == null) {
      throw new PreconditionError('A repeating coupon needs durationInMonths')
    }
    const name = params.name ?? `Goodwill · Maelle #${ctx.ticket.displayNumber}`
    const coupon = await stripe.createCoupon(
      {
        ...(params.kind === 'percent' ? { percentOff: params.percentOff! } : {}),
        ...(params.kind === 'amount'
          ? { amountOff: params.amountOffCents!, currency: params.currency! }
          : {}),
        duration: params.duration,
        ...(params.duration === 'repeating' ? { durationInMonths: params.durationInMonths! } : {}),
        name,
        metadata: { maelle_ticket: `#${ctx.ticket.displayNumber}`, maelle_key: ctx.idempotencyKey },
      },
      { idempotencyKey: ctx.idempotencyKey },
    )
    const base = {
      couponId: coupon.id,
      name,
      kind: params.kind,
      percentOff: coupon.percentOff,
      amountOffCents: coupon.amountOff,
      currency: coupon.currency,
      duration: coupon.duration,
      durationInMonths: coupon.durationInMonths,
    }
    if (params.applyTo === 'subscription') {
      let subId = params.stripeSubscriptionId
      if (!subId) {
        const customer = params.stripeCustomerId ?? ctx.ticket.stripeCustomerId
        if (!customer)
          throw new PreconditionError('No subscription or customer to apply the coupon to')
        const subs = await stripe.listSubscriptions(customer)
        const active = subs.find((s) => s.status === 'active' || s.status === 'trialing')
        if (!active) throw new PreconditionError('No active subscription to apply the coupon to')
        subId = active.id
      }
      await stripe.updateSubscription(
        subId,
        { couponId: coupon.id },
        { idempotencyKey: `${ctx.idempotencyKey}:apply` },
      )
      const externalRefs: Record<string, string> = {
        stripeCoupon: coupon.id,
        stripeSubscription: subId,
      }
      return { result: { ...base, appliedTo: subId }, externalRefs }
    }
    const code = `IR-${deterministicUuid(ctx.idempotencyKey).replace(/-/g, '').slice(0, 6).toUpperCase()}`
    const promo = await stripe.createPromotionCode(
      {
        couponId: coupon.id,
        code,
        maxRedemptions: 1,
        ...((params.stripeCustomerId ?? ctx.ticket.stripeCustomerId)
          ? { customer: (params.stripeCustomerId ?? ctx.ticket.stripeCustomerId)! }
          : {}),
      },
      { idempotencyKey: `${ctx.idempotencyKey}:promo` },
    )
    const externalRefs: Record<string, string> = {
      stripeCoupon: coupon.id,
      stripePromotionCode: promo.id,
    }
    return {
      result: { ...base, promotionCode: promo.code, promotionCodeId: promo.id },
      externalRefs,
    }
  },
}
