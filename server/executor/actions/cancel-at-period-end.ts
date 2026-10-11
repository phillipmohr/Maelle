import { PreconditionError, ProviderError } from '../errors'
import { isoDateFromUnix } from '../format'
import type { ActionHandler } from '../types'

/**
 * Stops renewals; the customer keeps access until the paid period ends. Returns that date.
 *
 * A paused subscription (InstaRadar is paused, IRDR-482) never charges and stays paused until it
 * ends. If Stripe refuses `cancel_at_period_end` on it, the subscription gets `cancel_at` = the end
 * of its latest paid period instead; when that is already over it stays paused and the action fails
 * with a clear message (never an immediate cancellation, never a deletion).
 */
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
    let updated
    try {
      updated = await stripe.updateSubscription(
        id,
        { cancelAtPeriodEnd: true },
        { idempotencyKey: ctx.idempotencyKey },
      )
    } catch (err) {
      const refused =
        current.status === 'paused' && err instanceof ProviderError && err.statusCode === 400
      if (!refused) throw err
      const end = await stripe.latestPaidPeriodEnd(id)
      if (!end || end * 1000 <= ctx.now().getTime()) {
        throw new PreconditionError(
          `Subscription ${id} is paused and Stripe refused to cancel it at period end; its paid period ${end ? `ended on ${isoDateFromUnix(end)}` : 'is unknown'}, so it stays paused and is not charged`,
        )
      }
      updated = await stripe.updateSubscription(
        id,
        { cancelAt: end },
        { idempotencyKey: `${ctx.idempotencyKey}:cancel-at` },
      )
    }
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
