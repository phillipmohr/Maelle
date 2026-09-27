/**
 * Stripe write client (STRIPE_WRITE_KEY). A narrow interface with slim types, so the actions read
 * well and the fake stays small. The real adapter wraps the Stripe SDK; every write carries the
 * execution's idempotency key as Stripe's `Idempotency-Key`, so a retry can never refund or cancel
 * twice.
 *
 * Key permissions (restricted key): write on Subscriptions, Refunds, Coupons, Promotion codes,
 * Invoices; read on Customers, Charges, Payment intents (see README, IRDR-457 section).
 */
import Stripe from 'stripe'
import type { StripeCancellationFeedback } from '#shared/actions'
import { fromStripeError } from '../errors'
import type { RequestOpts } from '../types'

export interface StripeSubscription {
  id: string
  customer: string
  status: string
  cancelAtPeriodEnd: boolean
  /** Unix seconds. Set by Stripe when cancel_at_period_end is true. */
  cancelAt: number | null
  canceledAt: number | null
  /** Unix seconds, from the first item (Stripe moved it off the subscription). */
  currentPeriodEnd: number | null
  discounts: string[]
  cancellationDetails: { feedback: string | null; comment: string | null } | null
}

export interface StripeCharge {
  id: string
  customer: string | null
  amount: number
  amountRefunded: number
  refunded: boolean
  paid: boolean
  status: string
  paymentIntent: string | null
  currency: string
  /** Unix seconds. */
  created: number
}

export interface StripePaymentIntent {
  id: string
  customer: string | null
  amount: number
  amountReceived: number
  status: string
  latestCharge: string | null
  currency: string
}

export interface StripeRefund {
  id: string
  amount: number
  currency: string
  status: string | null
  charge: string | null
  paymentIntent: string | null
  metadata: Record<string, string>
  created: number
}

export interface StripeInvoice {
  id: string
  customer: string | null
  subscription: string | null
  status: string | null
  autoAdvance: boolean
  amountDue: number
  attemptCount: number
  number: string | null
}

export interface StripeCoupon {
  id: string
  percentOff: number | null
  amountOff: number | null
  currency: string | null
  duration: string
  durationInMonths: number | null
  name: string | null
}

export interface StripePromotionCode {
  id: string
  code: string
  couponId: string
  active: boolean
}

export interface CancellationDetailsInput {
  feedback?: StripeCancellationFeedback
  comment?: string
}

export interface CouponCreateInput {
  percentOff?: number
  amountOff?: number
  currency?: string
  duration: 'once' | 'repeating' | 'forever'
  durationInMonths?: number
  name?: string
  metadata?: Record<string, string>
}

export interface StripeWriteClient {
  retrieveSubscription(id: string): Promise<StripeSubscription>
  /** Every subscription of the customer, any status. */
  listSubscriptions(customer: string): Promise<StripeSubscription[]>
  updateSubscription(
    id: string,
    params: {
      cancelAtPeriodEnd?: boolean
      cancellationDetails?: CancellationDetailsInput
      /** Adds a coupon to the subscription's discounts. */
      couponId?: string
      metadata?: Record<string, string>
    },
    opts: RequestOpts,
  ): Promise<StripeSubscription>
  cancelSubscription(
    id: string,
    params: { cancellationDetails?: CancellationDetailsInput },
    opts: RequestOpts,
  ): Promise<StripeSubscription>
  retrievePaymentIntent(id: string): Promise<StripePaymentIntent>
  retrieveCharge(id: string): Promise<StripeCharge>
  /** Newest first. */
  listCharges(customer: string, limit: number): Promise<StripeCharge[]>
  listRefunds(params: { charge?: string; paymentIntent?: string }): Promise<StripeRefund[]>
  createRefund(
    params: {
      charge?: string
      paymentIntent?: string
      amount: number
      reason: 'requested_by_customer' | 'duplicate' | 'fraudulent'
      metadata: Record<string, string>
    },
    opts: RequestOpts,
  ): Promise<StripeRefund>
  listOpenInvoices(params: { customer: string; subscription?: string }): Promise<StripeInvoice[]>
  retrieveInvoice(id: string): Promise<StripeInvoice>
  markInvoiceUncollectible(id: string, opts: RequestOpts): Promise<StripeInvoice>
  updateInvoice(
    id: string,
    params: { autoAdvance: boolean },
    opts: RequestOpts,
  ): Promise<StripeInvoice>
  createCoupon(params: CouponCreateInput, opts: RequestOpts): Promise<StripeCoupon>
  createPromotionCode(
    params: { couponId: string; code?: string; customer?: string; maxRedemptions?: number },
    opts: RequestOpts,
  ): Promise<StripePromotionCode>
}

// ---------------------------------------------------------------- real adapter

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null
  return typeof v === 'string' ? v : v.id
}

function mapSubscription(s: Stripe.Subscription): StripeSubscription {
  return {
    id: s.id,
    customer: idOf(s.customer) ?? '',
    status: s.status,
    cancelAtPeriodEnd: s.cancel_at_period_end,
    cancelAt: s.cancel_at,
    canceledAt: s.canceled_at,
    currentPeriodEnd: s.items?.data?.[0]?.current_period_end ?? null,
    discounts: (s.discounts ?? []).map((d) => (typeof d === 'string' ? d : d.id)),
    cancellationDetails: s.cancellation_details
      ? { feedback: s.cancellation_details.feedback, comment: s.cancellation_details.comment }
      : null,
  }
}

function mapCharge(c: Stripe.Charge): StripeCharge {
  return {
    id: c.id,
    customer: idOf(c.customer),
    amount: c.amount,
    amountRefunded: c.amount_refunded,
    refunded: c.refunded,
    paid: c.paid,
    status: c.status,
    paymentIntent: idOf(c.payment_intent),
    currency: c.currency,
    created: c.created,
  }
}

function mapPaymentIntent(p: Stripe.PaymentIntent): StripePaymentIntent {
  return {
    id: p.id,
    customer: idOf(p.customer),
    amount: p.amount,
    amountReceived: p.amount_received,
    status: p.status,
    latestCharge: idOf(p.latest_charge),
    currency: p.currency,
  }
}

function mapRefund(r: Stripe.Refund): StripeRefund {
  return {
    id: r.id,
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    charge: idOf(r.charge),
    paymentIntent: idOf(r.payment_intent),
    metadata: (r.metadata ?? {}) as Record<string, string>,
    created: r.created,
  }
}

function mapInvoice(i: Stripe.Invoice): StripeInvoice {
  return {
    id: i.id,
    customer: idOf(i.customer),
    subscription: idOf(i.parent?.subscription_details?.subscription ?? null),
    status: i.status,
    autoAdvance: i.auto_advance ?? false,
    amountDue: i.amount_due,
    attemptCount: i.attempt_count,
    number: i.number,
  }
}

function mapCoupon(c: Stripe.Coupon): StripeCoupon {
  return {
    id: c.id,
    percentOff: c.percent_off,
    amountOff: c.amount_off,
    currency: c.currency ?? null,
    duration: c.duration,
    durationInMonths: c.duration_in_months,
    name: c.name,
  }
}

function mapPromotionCode(p: Stripe.PromotionCode): StripePromotionCode {
  return {
    id: p.id,
    code: p.code,
    couponId: idOf(p.promotion?.coupon ?? null) ?? '',
    active: p.active,
  }
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    throw fromStripeError(err)
  }
}

export function createStripeWriteClient(apiKey: string): StripeWriteClient {
  const stripe = new Stripe(apiKey, {
    // Network-level retries are safe because every write carries an idempotency key.
    maxNetworkRetries: 2,
    timeout: 20_000,
    appInfo: { name: 'Maelle executor', url: 'https://instaradar.app' },
  })
  return {
    retrieveSubscription: (id) =>
      call(async () => mapSubscription(await stripe.subscriptions.retrieve(id))),
    listSubscriptions: (customer) =>
      call(async () => {
        const list = await stripe.subscriptions.list({ customer, status: 'all', limit: 20 })
        return list.data.map(mapSubscription)
      }),
    updateSubscription: (id, params, opts) =>
      call(async () => {
        const update: Stripe.SubscriptionUpdateParams = {}
        if (params.cancelAtPeriodEnd !== undefined)
          update.cancel_at_period_end = params.cancelAtPeriodEnd
        if (params.cancellationDetails) update.cancellation_details = params.cancellationDetails
        if (params.metadata) update.metadata = params.metadata
        if (params.couponId) {
          const current = await stripe.subscriptions.retrieve(id)
          const existing = (current.discounts ?? []).map((d) => (typeof d === 'string' ? d : d.id))
          update.discounts = [
            ...existing.map((d) => ({ discount: d })),
            { coupon: params.couponId },
          ]
        }
        return mapSubscription(
          await stripe.subscriptions.update(id, update, { idempotencyKey: opts.idempotencyKey }),
        )
      }),
    cancelSubscription: (id, params, opts) =>
      call(async () =>
        mapSubscription(
          await stripe.subscriptions.cancel(
            id,
            params.cancellationDetails ? { cancellation_details: params.cancellationDetails } : {},
            { idempotencyKey: opts.idempotencyKey },
          ),
        ),
      ),
    retrievePaymentIntent: (id) =>
      call(async () => mapPaymentIntent(await stripe.paymentIntents.retrieve(id))),
    retrieveCharge: (id) => call(async () => mapCharge(await stripe.charges.retrieve(id))),
    listCharges: (customer, limit) =>
      call(async () => (await stripe.charges.list({ customer, limit })).data.map(mapCharge)),
    listRefunds: (params) =>
      call(async () => {
        const list = await stripe.refunds.list({
          ...(params.charge ? { charge: params.charge } : {}),
          ...(params.paymentIntent ? { payment_intent: params.paymentIntent } : {}),
          limit: 20,
        })
        return list.data.map(mapRefund)
      }),
    createRefund: (params, opts) =>
      call(async () =>
        mapRefund(
          await stripe.refunds.create(
            {
              ...(params.charge ? { charge: params.charge } : {}),
              ...(params.paymentIntent ? { payment_intent: params.paymentIntent } : {}),
              amount: params.amount,
              reason: params.reason,
              metadata: params.metadata,
            },
            { idempotencyKey: opts.idempotencyKey },
          ),
        ),
      ),
    listOpenInvoices: (params) =>
      call(async () => {
        const list = await stripe.invoices.list({
          customer: params.customer,
          ...(params.subscription ? { subscription: params.subscription } : {}),
          status: 'open',
          limit: 20,
        })
        return list.data.map(mapInvoice)
      }),
    retrieveInvoice: (id) => call(async () => mapInvoice(await stripe.invoices.retrieve(id))),
    markInvoiceUncollectible: (id, opts) =>
      call(async () =>
        mapInvoice(
          await stripe.invoices.markUncollectible(id, {}, { idempotencyKey: opts.idempotencyKey }),
        ),
      ),
    updateInvoice: (id, params, opts) =>
      call(async () =>
        mapInvoice(
          await stripe.invoices.update(
            id,
            { auto_advance: params.autoAdvance },
            { idempotencyKey: opts.idempotencyKey },
          ),
        ),
      ),
    createCoupon: (params, opts) =>
      call(async () =>
        mapCoupon(
          await stripe.coupons.create(
            {
              ...(params.percentOff !== undefined ? { percent_off: params.percentOff } : {}),
              ...(params.amountOff !== undefined ? { amount_off: params.amountOff } : {}),
              ...(params.currency ? { currency: params.currency } : {}),
              duration: params.duration,
              ...(params.durationInMonths !== undefined
                ? { duration_in_months: params.durationInMonths }
                : {}),
              ...(params.name ? { name: params.name } : {}),
              ...(params.metadata ? { metadata: params.metadata } : {}),
            },
            { idempotencyKey: opts.idempotencyKey },
          ),
        ),
      ),
    createPromotionCode: (params, opts) =>
      call(async () =>
        mapPromotionCode(
          await stripe.promotionCodes.create(
            {
              promotion: { type: 'coupon', coupon: params.couponId },
              ...(params.code ? { code: params.code } : {}),
              ...(params.customer ? { customer: params.customer } : {}),
              ...(params.maxRedemptions !== undefined
                ? { max_redemptions: params.maxRedemptions }
                : {}),
            },
            { idempotencyKey: opts.idempotencyKey },
          ),
        ),
      ),
  }
}
