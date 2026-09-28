import { PreconditionError } from '../errors'
import { formatMoney, isoDateFromUnix, shortDate } from '../format'
import type { ActionHandler } from '../types'
import type { StripeCharge } from '../clients/stripe'

/**
 * Refunds only the latest successful payment, never one that was already refunded, at most the paid
 * amount, within the daily count and amount limits from settings. Irreversible.
 */
export const refundLatestPayment: ActionHandler<'refund_latest_payment'> = {
  type: 'refund_latest_payment',
  consequence: 'nothing was charged or refunded',
  async run(params, ctx) {
    const { stripe } = ctx.clients
    let charge: StripeCharge
    if (params.stripeChargeId) {
      charge = await stripe.retrieveCharge(params.stripeChargeId)
    } else if (params.stripePaymentIntentId) {
      const pi = await stripe.retrievePaymentIntent(params.stripePaymentIntentId)
      if (!pi.latestCharge) {
        throw new PreconditionError(
          `Payment ${pi.id} has no charge to refund (status ${pi.status})`,
        )
      }
      charge = await stripe.retrieveCharge(pi.latestCharge)
    } else {
      throw new PreconditionError('No payment given: a payment intent or charge id is required')
    }

    // A previous attempt may have created the refund and then failed to record it.
    const refunds = await stripe.listRefunds({ charge: charge.id })
    const own = refunds.find((r) => r.metadata.maelle_key === ctx.idempotencyKey)
    if (own) {
      return {
        result: {
          refundId: own.id,
          amountCents: own.amount,
          currency: own.currency,
          chargeId: charge.id,
          paymentIntentId: charge.paymentIntent,
          alreadyRefunded: true,
        },
        externalRefs: { stripeRefund: own.id, stripeCharge: charge.id },
      }
    }

    if (!charge.paid || charge.status !== 'succeeded') {
      throw new PreconditionError(`Payment ${charge.id} did not succeed (status ${charge.status})`)
    }
    if (charge.amountRefunded > 0) {
      throw new PreconditionError(
        `Payment ${charge.id} was already refunded (${formatMoney(charge.amountRefunded, charge.currency)} of ${formatMoney(charge.amount, charge.currency)})`,
      )
    }
    const customer = charge.customer ?? ctx.ticket.stripeCustomerId
    if (customer) {
      const charges = await stripe.listCharges(customer, 10)
      const latest = charges
        .filter((c) => c.paid && c.status === 'succeeded')
        .sort((a, b) => b.created - a.created)[0]
      if (latest && latest.id !== charge.id) {
        throw new PreconditionError(
          `Not the latest payment: ${latest.id} from ${shortDate(isoDateFromUnix(latest.created))} is newer`,
        )
      }
    }
    if (params.amountCents > charge.amount) {
      throw new PreconditionError(
        `Refund amount ${formatMoney(params.amountCents, charge.currency)} is more than the payment of ${formatMoney(charge.amount, charge.currency)}`,
      )
    }
    if (params.currency !== charge.currency.toLowerCase()) {
      throw new PreconditionError(
        `Currency mismatch: the payment is in ${charge.currency.toUpperCase()}, the refund in ${params.currency.toUpperCase()}`,
      )
    }

    const today = await ctx.store.refundsToday({
      timezone: ctx.settings.timezone,
      excludeBaseKey: ctx.idempotencyKey,
    })
    if (today.count >= ctx.settings.refundDailyLimitCount) {
      throw new PreconditionError(
        `Daily refund limit reached (${today.count} of ${ctx.settings.refundDailyLimitCount} refunds today)`,
      )
    }
    if (today.amountCents + params.amountCents > ctx.settings.refundDailyLimitAmountCents) {
      throw new PreconditionError(
        `Daily refund amount limit reached (${formatMoney(today.amountCents)} of ${formatMoney(ctx.settings.refundDailyLimitAmountCents)} refunded today, this refund is ${formatMoney(params.amountCents, charge.currency)})`,
      )
    }

    const refund = await stripe.createRefund(
      {
        charge: charge.id,
        amount: params.amountCents,
        reason: params.reason,
        metadata: {
          maelle_ticket: `#${ctx.ticket.displayNumber}`,
          maelle_key: ctx.idempotencyKey,
        },
      },
      { idempotencyKey: ctx.idempotencyKey },
    )
    return {
      result: {
        refundId: refund.id,
        amountCents: refund.amount,
        currency: refund.currency,
        chargeId: charge.id,
        paymentIntentId: charge.paymentIntent,
        cardLabel: params.cardLabel ?? null,
        paymentDate: params.paymentDate ?? isoDateFromUnix(charge.created),
        partial: refund.amount < charge.amount,
      },
      externalRefs: { stripeRefund: refund.id, stripeCharge: charge.id },
    }
  },
}
