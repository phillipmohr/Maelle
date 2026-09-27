import type { ActionHandler } from '../types'

/** Logs why the customer left: a cancellation_reasons row plus Stripe cancellation_details. */
export const storeCancellationReason: ActionHandler<'store_cancellation_reason'> = {
  type: 'store_cancellation_reason',
  consequence: 'the reason was not stored',
  async run(params, ctx) {
    const subscriptionId = params.stripeSubscriptionId ?? null
    const { inserted } = await ctx.store.insertCancellationReason({
      ticketId: ctx.ticket.id,
      customerEmail: ctx.ticket.customerEmail,
      stripeCustomerId: params.stripeCustomerId ?? ctx.ticket.stripeCustomerId,
      stripeSubscriptionId: subscriptionId,
      feedback: params.feedback,
      verbatimReason: params.comment,
    })
    let stripeUpdated = false
    let stripeNote: string | null = subscriptionId ? null : 'no subscription id, Maelle row only'
    if (subscriptionId) {
      const sub = await ctx.clients.stripe.retrieveSubscription(subscriptionId)
      if (sub.status === 'canceled') {
        stripeNote = 'subscription already cancelled, Stripe keeps the details it has'
      } else {
        await ctx.clients.stripe.updateSubscription(
          subscriptionId,
          { cancellationDetails: { feedback: params.feedback, comment: params.comment } },
          { idempotencyKey: ctx.idempotencyKey },
        )
        stripeUpdated = true
      }
    }
    const externalRefs: Record<string, string> = subscriptionId
      ? { stripeSubscription: subscriptionId }
      : {}
    return {
      result: {
        feedback: params.feedback,
        comment: params.comment,
        storedInMaelle: true,
        alreadyStored: !inserted,
        stripeUpdated,
        stripeNote,
      },
      externalRefs: externalRefs,
    }
  },
}
