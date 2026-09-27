import { PreconditionError } from '../errors'
import { isoDateFromUnix } from '../format'
import type { ActionHandler } from '../types'

/** Stops renewals; the customer keeps access until the paid period ends. Returns that date. */
export const cancelAtPeriodEnd: ActionHandler<'cancel_at_period_end'> = {
  type: 'cancel_at_period_end',
  consequence: 'the subscription was not changed',
  async run(params, ctx) {
    const { stripe } = ctx.clients
    const id = params.stripeSubscriptionId
    const current = await stripe.retrieveSubscription(id)
    if (current.status === 'canceled') {
      return {
        result: {
          subscriptionId: id,
          alreadyCancelled: true,
          cancelledAt: isoDateFromUnix(current.canceledAt),
          accessUntil: isoDateFromUnix(current.canceledAt),
        },
        externalRefs: { stripeSubscription: id },
      }
    }
    if (current.cancelAtPeriodEnd) {
      return {
        result: {
          subscriptionId: id,
          alreadyScheduled: true,
          accessUntil: isoDateFromUnix(current.cancelAt ?? current.currentPeriodEnd),
        },
        externalRefs: { stripeSubscription: id },
      }
    }
    if (current.status === 'incomplete_expired') {
      throw new PreconditionError(`Subscription ${id} is ${current.status} and cannot be cancelled`)
    }
    const updated = await stripe.updateSubscription(
      id,
      { cancelAtPeriodEnd: true },
      { idempotencyKey: ctx.idempotencyKey },
    )
    return {
      result: {
        subscriptionId: id,
        cancelAtPeriodEnd: true,
        accessUntil:
          isoDateFromUnix(updated.cancelAt ?? updated.currentPeriodEnd) ??
          params.accessUntil ??
          null,
      },
      externalRefs: { stripeSubscription: id },
    }
  },
}
