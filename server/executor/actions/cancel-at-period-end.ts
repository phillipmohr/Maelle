import { ACTION_PARAM_SCHEMAS } from '#shared/actions'
import type { CancellationDetailsInput } from '../clients/stripe'
import { PreconditionError } from '../errors'
import { isoDateFromUnix } from '../format'
import type { ActionContext, ActionHandler } from '../types'

/**
 * Stops renewals; the customer keeps access until the paid period ends. Returns that date.
 *
 * A paused subscription (InstaRadar is paused, IRDR-479) is cancelled now instead (IRDR-483):
 * Stripe refuses `cancel_at_period_end` and `cancel_at` on it and only allows resume or the cancel
 * endpoint, and its billing period already ended at the pause (`current_period_end` = pause time).
 * It never charges again, and InstaRadar keeps the data on cancellation (preservation hold,
 * IRDR-474). The proposal's cancellation reason goes along with the cancel call, because Stripe
 * takes `cancellation_details` on a paused subscription only when it is cancelled.
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
    if (current.status === 'paused') {
      // Own key: earlier attempts used the base key on the update endpoint, and Stripe refuses a key
      // reused on another endpoint.
      const cancelled = await stripe.cancelSubscription(
        id,
        { cancellationDetails: cancellationDetailsOf(ctx) },
        { idempotencyKey: `${ctx.idempotencyKey}:cancel` },
      )
      const cancelledAt =
        isoDateFromUnix(cancelled.canceledAt) ?? ctx.now().toISOString().slice(0, 10)
      return {
        result: {
          subscriptionId: id,
          status: cancelled.status,
          cancelledAt,
          accessUntil: cancelledAt,
          note: 'Paused subscription: cancelled now, its billing period ended at the pause',
        },
        externalRefs: { stripeSubscription: id },
      }
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

/** The reason of the proposal's enabled Store cancellation reason action, for Stripe's cancel call. */
function cancellationDetailsOf(ctx: ActionContext): CancellationDetailsInput | undefined {
  const action = ctx.proposal?.actions.find(
    (a) => a.type === 'store_cancellation_reason' && a.enabled,
  )
  if (!action) return undefined
  const parsed = ACTION_PARAM_SCHEMAS.store_cancellation_reason.safeParse(action.params)
  if (!parsed.success) return undefined
  return { feedback: parsed.data.feedback, comment: parsed.data.comment }
}
