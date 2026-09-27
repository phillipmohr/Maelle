/**
 * In-memory Stripe for tests and the dev server. Keeps subscriptions, invoices, charges, payment
 * intents, refunds, coupons and promotion codes, honours idempotency keys the way Stripe does (same
 * key + same params → the stored response; same key + different params → idempotency_error), and
 * lets tests inject failures (`failNext`).
 */
import { ProviderError } from '../errors'
import type { RequestOpts } from '../types'
import type {
  StripeCharge,
  StripeCoupon,
  StripeInvoice,
  StripePaymentIntent,
  StripePromotionCode,
  StripeRefund,
  StripeSubscription,
  StripeWriteClient,
} from './stripe'

export type FakeStripeOp = keyof StripeWriteClient

export interface FakeStripeFailure {
  op: FakeStripeOp
  error: ProviderError
  /** How many calls fail before the op works again (default 1). */
  times?: number
}

export interface FakeStripe extends StripeWriteClient {
  readonly state: {
    subscriptions: Map<string, StripeSubscription>
    charges: Map<string, StripeCharge>
    paymentIntents: Map<string, StripePaymentIntent>
    refunds: Map<string, StripeRefund>
    invoices: Map<string, StripeInvoice>
    coupons: Map<string, StripeCoupon>
    promotionCodes: Map<string, StripePromotionCode>
  }
  readonly calls: { op: FakeStripeOp; args: unknown[]; idempotencyKey?: string }[]
  failNext(failure: FakeStripeFailure): void
  /** Convenience: an active customer with a subscription and one succeeded payment. */
  seedCustomer(input: {
    customer: string
    subscription: string
    paymentIntent: string
    charge: string
    amount: number
    currency?: string
    status?: string
    currentPeriodEnd?: number
    created?: number
  }): void
  addCharge(charge: StripeCharge, paymentIntent?: StripePaymentIntent): void
  addInvoice(invoice: StripeInvoice): void
  reset(): void
}

let seq = 0
function fakeId(prefix: string) {
  seq += 1
  return `${prefix}_fake${seq.toString(36).padStart(6, '0')}`
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

export function rateLimitError(requestId = 'req_fake429'): ProviderError {
  return new ProviderError('Stripe', 'Too many requests', {
    code: 'rate_limit',
    statusCode: 429,
    requestId,
    retryable: true,
  })
}

export function createFakeStripe(): FakeStripe {
  const state: FakeStripe['state'] = {
    subscriptions: new Map(),
    charges: new Map(),
    paymentIntents: new Map(),
    refunds: new Map(),
    invoices: new Map(),
    coupons: new Map(),
    promotionCodes: new Map(),
  }
  const calls: FakeStripe['calls'] = []
  const failures: FakeStripeFailure[] = []
  const idempotency = new Map<string, { fingerprint: string; response: unknown }>()

  function record(op: FakeStripeOp, args: unknown[], opts?: RequestOpts) {
    calls.push({ op, args: clone(args), ...(opts ? { idempotencyKey: opts.idempotencyKey } : {}) })
    const f = failures.find((x) => x.op === op)
    if (f) {
      f.times = (f.times ?? 1) - 1
      if (f.times <= 0) failures.splice(failures.indexOf(f), 1)
      throw f.error
    }
  }

  /** Stripe semantics: the first response for a key is replayed; different params are an error. */
  function idempotent<T>(op: FakeStripeOp, opts: RequestOpts, params: unknown, fn: () => T): T {
    const scopedKey = `${op}:${opts.idempotencyKey}`
    const fingerprint = JSON.stringify(params)
    const seen = idempotency.get(scopedKey)
    if (seen) {
      if (seen.fingerprint !== fingerprint) {
        throw new ProviderError(
          'Stripe',
          'Keys for idempotent requests can only be used with the same parameters they were first used with.',
          { code: 'idempotency_error', statusCode: 400, requestId: 'req_fakeidem' },
        )
      }
      return clone(seen.response as T)
    }
    const response = fn()
    idempotency.set(scopedKey, { fingerprint, response: clone(response) })
    return response
  }

  function missing(kind: string, id: string): ProviderError {
    return new ProviderError('Stripe', `No such ${kind}: '${id}'`, {
      code: 'resource_missing',
      statusCode: 404,
      requestId: 'req_fake404',
    })
  }

  function sub(id: string): StripeSubscription {
    const s = state.subscriptions.get(id)
    if (!s) throw missing('subscription', id)
    return s
  }

  const api: FakeStripe = {
    state,
    calls,
    failNext(failure) {
      failures.push({ ...failure, times: failure.times ?? 1 })
    },
    seedCustomer(input) {
      const created = input.created ?? Math.floor(Date.now() / 1000) - 12 * 86_400
      state.subscriptions.set(input.subscription, {
        id: input.subscription,
        customer: input.customer,
        status: input.status ?? 'active',
        cancelAtPeriodEnd: false,
        cancelAt: null,
        canceledAt: null,
        currentPeriodEnd: input.currentPeriodEnd ?? created + 30 * 86_400,
        discounts: [],
        cancellationDetails: null,
      })
      api.addCharge(
        {
          id: input.charge,
          customer: input.customer,
          amount: input.amount,
          amountRefunded: 0,
          refunded: false,
          paid: true,
          status: 'succeeded',
          paymentIntent: input.paymentIntent,
          currency: input.currency ?? 'usd',
          created,
        },
        {
          id: input.paymentIntent,
          customer: input.customer,
          amount: input.amount,
          amountReceived: input.amount,
          status: 'succeeded',
          latestCharge: input.charge,
          currency: input.currency ?? 'usd',
        },
      )
    },
    addCharge(charge, paymentIntent) {
      state.charges.set(charge.id, clone(charge))
      if (paymentIntent) state.paymentIntents.set(paymentIntent.id, clone(paymentIntent))
    },
    addInvoice(invoice) {
      state.invoices.set(invoice.id, clone(invoice))
    },
    reset() {
      for (const m of Object.values(state)) m.clear()
      calls.length = 0
      failures.length = 0
      idempotency.clear()
    },

    async retrieveSubscription(id) {
      record('retrieveSubscription', [id])
      return clone(sub(id))
    },
    async listSubscriptions(customer) {
      record('listSubscriptions', [customer])
      return clone([...state.subscriptions.values()].filter((s) => s.customer === customer))
    },
    async updateSubscription(id, params, opts) {
      record('updateSubscription', [id, params], opts)
      return idempotent('updateSubscription', opts, [id, params], () => {
        const s = sub(id)
        if (s.status === 'canceled') {
          throw new ProviderError(
            'Stripe',
            `A canceled subscription can only update its metadata.`,
            {
              code: 'resource_missing',
              statusCode: 400,
              requestId: 'req_fakecanc',
            },
          )
        }
        if (params.cancelAtPeriodEnd !== undefined) {
          s.cancelAtPeriodEnd = params.cancelAtPeriodEnd
          s.cancelAt = params.cancelAtPeriodEnd ? s.currentPeriodEnd : null
        }
        if (params.cancellationDetails) {
          s.cancellationDetails = {
            feedback: params.cancellationDetails.feedback ?? null,
            comment: params.cancellationDetails.comment ?? null,
          }
        }
        if (params.couponId) {
          if (!state.coupons.has(params.couponId)) throw missing('coupon', params.couponId)
          s.discounts = [...s.discounts, params.couponId]
        }
        return clone(s)
      })
    },
    async cancelSubscription(id, params, opts) {
      record('cancelSubscription', [id, params], opts)
      return idempotent('cancelSubscription', opts, [id, params], () => {
        const s = sub(id)
        if (s.status === 'canceled') throw missing('subscription', id)
        s.status = 'canceled'
        s.canceledAt = Math.floor(Date.now() / 1000)
        s.cancelAtPeriodEnd = false
        s.cancelAt = null
        if (params.cancellationDetails) {
          s.cancellationDetails = {
            feedback: params.cancellationDetails.feedback ?? null,
            comment: params.cancellationDetails.comment ?? null,
          }
        }
        return clone(s)
      })
    },
    async retrievePaymentIntent(id) {
      record('retrievePaymentIntent', [id])
      const p = state.paymentIntents.get(id)
      if (!p) throw missing('payment_intent', id)
      return clone(p)
    },
    async retrieveCharge(id) {
      record('retrieveCharge', [id])
      const c = state.charges.get(id)
      if (!c) throw missing('charge', id)
      return clone(c)
    },
    async listCharges(customer, limit) {
      record('listCharges', [customer, limit])
      return clone(
        [...state.charges.values()]
          .filter((c) => c.customer === customer)
          .sort((a, b) => b.created - a.created)
          .slice(0, limit),
      )
    },
    async listRefunds(params) {
      record('listRefunds', [params])
      return clone(
        [...state.refunds.values()].filter(
          (r) =>
            (!params.charge || r.charge === params.charge) &&
            (!params.paymentIntent || r.paymentIntent === params.paymentIntent),
        ),
      )
    },
    async createRefund(params, opts) {
      record('createRefund', [params], opts)
      return idempotent('createRefund', opts, [params], () => {
        let charge: StripeCharge | undefined
        if (params.charge) charge = state.charges.get(params.charge)
        else if (params.paymentIntent) {
          const pi = state.paymentIntents.get(params.paymentIntent)
          if (!pi) throw missing('payment_intent', params.paymentIntent)
          charge = pi.latestCharge ? state.charges.get(pi.latestCharge) : undefined
        }
        if (!charge) throw missing('charge', params.charge ?? params.paymentIntent ?? '?')
        if (charge.amountRefunded + params.amount > charge.amount) {
          throw new ProviderError(
            'Stripe',
            `Refund amount (${params.amount}) is greater than unrefunded amount on charge (${charge.amount - charge.amountRefunded})`,
            { code: 'charge_already_refunded', statusCode: 400, requestId: 'req_fakeref' },
          )
        }
        charge.amountRefunded += params.amount
        charge.refunded = charge.amountRefunded >= charge.amount
        const refund: StripeRefund = {
          id: fakeId('re'),
          amount: params.amount,
          currency: charge.currency,
          status: 'succeeded',
          charge: charge.id,
          paymentIntent: charge.paymentIntent,
          metadata: { ...params.metadata },
          created: Math.floor(Date.now() / 1000),
        }
        state.refunds.set(refund.id, refund)
        return clone(refund)
      })
    },
    async listOpenInvoices(params) {
      record('listOpenInvoices', [params])
      return clone(
        [...state.invoices.values()].filter(
          (i) =>
            i.customer === params.customer &&
            i.status === 'open' &&
            (!params.subscription || i.subscription === params.subscription),
        ),
      )
    },
    async retrieveInvoice(id) {
      record('retrieveInvoice', [id])
      const i = state.invoices.get(id)
      if (!i) throw missing('invoice', id)
      return clone(i)
    },
    async markInvoiceUncollectible(id, opts) {
      record('markInvoiceUncollectible', [id], opts)
      return idempotent('markInvoiceUncollectible', opts, [id], () => {
        const i = state.invoices.get(id)
        if (!i) throw missing('invoice', id)
        if (i.status !== 'open') {
          throw new ProviderError('Stripe', `Invoice ${id} is ${i.status}, not open.`, {
            code: 'invoice_not_open',
            statusCode: 400,
            requestId: 'req_fakeinv',
          })
        }
        i.status = 'uncollectible'
        i.autoAdvance = false
        return clone(i)
      })
    },
    async updateInvoice(id, params, opts) {
      record('updateInvoice', [id, params], opts)
      return idempotent('updateInvoice', opts, [id, params], () => {
        const i = state.invoices.get(id)
        if (!i) throw missing('invoice', id)
        i.autoAdvance = params.autoAdvance
        return clone(i)
      })
    },
    async createCoupon(params, opts) {
      record('createCoupon', [params], opts)
      return idempotent('createCoupon', opts, [params], () => {
        const c: StripeCoupon = {
          id: fakeId('cpn'),
          percentOff: params.percentOff ?? null,
          amountOff: params.amountOff ?? null,
          currency: params.currency ?? null,
          duration: params.duration,
          durationInMonths: params.durationInMonths ?? null,
          name: params.name ?? null,
        }
        state.coupons.set(c.id, c)
        return clone(c)
      })
    },
    async createPromotionCode(params, opts) {
      record('createPromotionCode', [params], opts)
      return idempotent('createPromotionCode', opts, [params], () => {
        if (!state.coupons.has(params.couponId)) throw missing('coupon', params.couponId)
        const p: StripePromotionCode = {
          id: fakeId('promo'),
          code: params.code ?? `PROMO${seq.toString(36).toUpperCase()}`,
          couponId: params.couponId,
          active: true,
        }
        state.promotionCodes.set(p.id, p)
        return clone(p)
      })
    },
  }
  return api
}
