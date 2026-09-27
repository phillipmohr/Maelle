import { PreconditionError, ProviderError } from '../errors'
import type { ActionHandler } from '../types'
import type { StripeInvoice } from '../clients/stripe'

const ACTIVE = new Set(['active', 'trialing'])

/**
 * Stops collection of open invoices so Smart Retries end, without deleting anything: each open
 * invoice is marked uncollectible; when Stripe refuses that, auto-advance is switched off instead.
 */
export const stopFailedPaymentRetries: ActionHandler<'stop_failed_payment_retries'> = {
  type: 'stop_failed_payment_retries',
  consequence: 'no invoice was changed',
  async run(params, ctx) {
    const { stripe } = ctx.clients
    if (params.stripeSubscriptionId) {
      const sub = await stripe.retrieveSubscription(params.stripeSubscriptionId)
      if (ACTIVE.has(sub.status)) {
        throw new PreconditionError(
          `Subscription ${sub.id} is ${sub.status}; retries are only stopped for cancelled or inactive subscriptions`,
        )
      }
    }
    let invoices: StripeInvoice[]
    if (params.stripeInvoiceIds.length > 0) {
      invoices = await Promise.all(params.stripeInvoiceIds.map((id) => stripe.retrieveInvoice(id)))
    } else {
      invoices = await stripe.listOpenInvoices({
        customer: params.stripeCustomerId,
        ...(params.stripeSubscriptionId ? { subscription: params.stripeSubscriptionId } : {}),
      })
    }
    const changed: { id: string; number: string | null; action: string; amountDue: number }[] = []
    const skipped: { id: string; status: string | null }[] = []
    for (const inv of invoices) {
      if (inv.status !== 'open') {
        skipped.push({ id: inv.id, status: inv.status })
        continue
      }
      const key = `${ctx.idempotencyKey}:${inv.id}`
      try {
        await stripe.markInvoiceUncollectible(inv.id, { idempotencyKey: key })
        changed.push({
          id: inv.id,
          number: inv.number,
          action: 'marked_uncollectible',
          amountDue: inv.amountDue,
        })
      } catch (err) {
        if (err instanceof ProviderError && !err.retryable) {
          await stripe.updateInvoice(
            inv.id,
            { autoAdvance: false },
            { idempotencyKey: `${key}:aa` },
          )
          changed.push({
            id: inv.id,
            number: inv.number,
            action: 'auto_advance_off',
            amountDue: inv.amountDue,
          })
        } else {
          throw err
        }
      }
    }
    return {
      result: {
        customerId: params.stripeCustomerId,
        invoices: changed,
        skipped,
        note: changed.length === 0 ? 'No open invoices, nothing to stop' : null,
      },
      externalRefs: Object.fromEntries(changed.map((c, i) => [`stripeInvoice${i + 1}`, c.id])),
    }
  },
}
