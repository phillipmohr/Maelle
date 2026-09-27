import { isoDateFromUnix } from '../format'
import type { ActionHandler } from '../types'

/**
 * Ends the subscription now (irreversible). InstaRadar's own `customer.subscription.deleted`
 * webhook deletes the tracked profiles, so this action does not touch InstaRadar data (assumption,
 * see docs/instaradar/README.md).
 */
export const cancelImmediately: ActionHandler<'cancel_immediately'> = {
  type: 'cancel_immediately',
  consequence: 'the subscription was not cancelled',
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
        },
        externalRefs: { stripeSubscription: id },
      }
    }
    const cancelled = await stripe.cancelSubscription(
      id,
      {},
      { idempotencyKey: ctx.idempotencyKey },
    )
    return {
      result: {
        subscriptionId: id,
        status: cancelled.status,
        cancelledAt: isoDateFromUnix(cancelled.canceledAt) ?? ctx.now().toISOString().slice(0, 10),
        profilesAffected: params.profilesAffected ?? null,
        note: 'InstaRadar deletes the tracked profiles through its customer.subscription.deleted webhook',
      },
      externalRefs: { stripeSubscription: id },
    }
  },
}
