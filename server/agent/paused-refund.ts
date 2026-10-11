/**
 * Refund facts while InstaRadar is paused (IRDR-482). Deterministic, so the model never calculates
 * an amount: the one refundable payment from before the pause with its prorated share, and every
 * charge made on or after the pause (refunded in full by a separate process).
 */
import type {
  StripeChargeSummary,
  StripeInvoiceSummary,
  StripeRefundSummary,
  StripeSubscriptionSummary,
} from './types'

export interface PrePausePayment {
  chargeId: string
  paymentIntentId: string | null
  date: string
  amountCents: number
  currency: string
  /** The paid period of this payment; null when neither the invoice nor the plan tells it. */
  periodStart: string | null
  periodEnd: string | null
  /** `invoice`: from the invoice line item. `plan`: estimated from the plan interval. */
  periodSource: 'invoice' | 'plan' | null
  refundedCents: number
  remainingRefundableCents: number
  /** Whole days of the paid period from the pause to its end, and the period length in days. */
  unusedDays: number | null
  periodDays: number | null
  /** The unused share of the payment, capped at what is still refundable; null without a period. */
  proratedAmountCents: number | null
}

export interface PostPauseCharge {
  chargeId: string
  paymentIntentId: string | null
  date: string
  amountCents: number
  currency: string
  refundedCents: number
  remainingRefundableCents: number
  /** Date of the latest refund on this charge, if any. */
  refundedAt: string | null
}

const DAY = 86_400_000

/** `amount × unused ÷ period`, rounded half up, clamped to 0..remaining. Pure. */
export function proratedAmount(input: {
  amountCents: number
  refundedCents: number
  periodStart: string
  periodEnd: string
  pausedAt: string
}): { cents: number; unusedMs: number; periodMs: number } {
  const start = new Date(input.periodStart).getTime()
  const end = new Date(input.periodEnd).getTime()
  const paused = new Date(input.pausedAt).getTime()
  const periodMs = Math.max(0, end - start)
  const unusedMs = Math.min(periodMs, Math.max(0, end - Math.max(start, paused)))
  const remaining = Math.max(0, input.amountCents - input.refundedCents)
  if (periodMs === 0) return { cents: 0, unusedMs: 0, periodMs: 0 }
  // Amounts are in the currency's minor unit (yen for JPY), so an integer is right for every currency.
  const cents = Math.min(
    remaining,
    Math.max(0, Math.round((input.amountCents * unusedMs) / periodMs)),
  )
  return { cents, unusedMs, periodMs }
}

function addInterval(iso: string, interval: StripeSubscriptionSummary['interval']): string | null {
  const d = new Date(iso)
  switch (interval) {
    case 'day':
      d.setUTCDate(d.getUTCDate() + 1)
      break
    case 'week':
      d.setUTCDate(d.getUTCDate() + 7)
      break
    case 'month':
      d.setUTCMonth(d.getUTCMonth() + 1)
      break
    case 'year':
      d.setUTCFullYear(d.getUTCFullYear() + 1)
      break
    default:
      return null
  }
  return d.toISOString()
}

function invoiceFor(
  charge: StripeChargeSummary,
  invoices: StripeInvoiceSummary[],
): StripeInvoiceSummary | null {
  if (charge.invoiceId) {
    const byId = invoices.find((i) => i.id === charge.invoiceId)
    if (byId) return byId
  }
  // Newer API versions drop `charge.invoice`: match the paid invoice by amount and payment time.
  const created = new Date(charge.created).getTime()
  return (
    invoices.find(
      (i) =>
        i.status === 'paid' &&
        i.amountPaidCents === charge.amountCents &&
        i.paidAt != null &&
        Math.abs(new Date(i.paidAt).getTime() - created) < DAY,
    ) ?? null
  )
}

export function pausedRefundFacts(input: {
  charges: StripeChargeSummary[]
  invoices: StripeInvoiceSummary[]
  refunds: StripeRefundSummary[]
  subscriptions: StripeSubscriptionSummary[]
  pausedAt: string
}): { prePausePayment: PrePausePayment | null; postPauseCharges: PostPauseCharge[] } {
  const pausedMs = new Date(input.pausedAt).getTime()
  const paid = input.charges
    .filter((c) => c.status === 'succeeded')
    .sort((a, b) => b.created.localeCompare(a.created))
  const remaining = (c: StripeChargeSummary) => Math.max(0, c.amountCents - c.amountRefundedCents)

  const postPauseCharges: PostPauseCharge[] = paid
    .filter((c) => new Date(c.created).getTime() >= pausedMs)
    .map((c) => {
      const latestRefund = input.refunds
        .filter((r) => r.chargeId === c.id)
        .sort((a, b) => b.created.localeCompare(a.created))[0]
      return {
        chargeId: c.id,
        paymentIntentId: c.paymentIntentId,
        date: c.created,
        amountCents: c.amountCents,
        currency: c.currency,
        refundedCents: c.amountRefundedCents,
        remainingRefundableCents: remaining(c),
        refundedAt: latestRefund?.created ?? null,
      }
    })

  const pre = paid.find((c) => new Date(c.created).getTime() < pausedMs)
  if (!pre) return { prePausePayment: null, postPauseCharges }

  const invoice = invoiceFor(pre, input.invoices)
  let periodStart: string | null = null
  let periodEnd: string | null = null
  let periodSource: PrePausePayment['periodSource'] = null
  if (invoice?.periodStart && invoice.periodEnd) {
    periodStart = invoice.periodStart
    periodEnd = invoice.periodEnd
    periodSource = 'invoice'
  } else {
    const sub =
      input.subscriptions.find((s) => s.id === invoice?.subscriptionId) ??
      [...input.subscriptions].sort((a, b) => b.created.localeCompare(a.created))[0]
    const end = sub ? addInterval(pre.created, sub.interval) : null
    if (end) {
      periodStart = pre.created
      periodEnd = end
      periodSource = 'plan'
    }
  }

  const base = {
    chargeId: pre.id,
    paymentIntentId: pre.paymentIntentId,
    date: pre.created,
    amountCents: pre.amountCents,
    currency: pre.currency,
    periodStart,
    periodEnd,
    periodSource,
    refundedCents: pre.amountRefundedCents,
    remainingRefundableCents: remaining(pre),
  }
  if (!periodStart || !periodEnd) {
    return {
      prePausePayment: { ...base, unusedDays: null, periodDays: null, proratedAmountCents: null },
      postPauseCharges,
    }
  }
  const p = proratedAmount({
    amountCents: pre.amountCents,
    refundedCents: pre.amountRefundedCents,
    periodStart,
    periodEnd,
    pausedAt: input.pausedAt,
  })
  return {
    prePausePayment: {
      ...base,
      unusedDays: Math.round((p.unusedMs / DAY) * 10) / 10,
      periodDays: Math.round((p.periodMs / DAY) * 10) / 10,
      proratedAmountCents: p.cents,
    },
    postPauseCharges,
  }
}

/** True when a refund may target this payment while paused: the pre-pause payment or a post-pause charge. */
export function isPausedRefundTarget(
  target: string,
  facts: { prePausePayment: PrePausePayment | null; postPauseCharges: PostPauseCharge[] },
): boolean {
  const ids = [
    facts.prePausePayment?.chargeId,
    facts.prePausePayment?.paymentIntentId,
    ...facts.postPauseCharges.flatMap((c) => [c.chargeId, c.paymentIntentId]),
  ].filter(Boolean)
  return ids.includes(target)
}
