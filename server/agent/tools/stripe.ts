/**
 * Stripe, read only. The real adapter is constructed with STRIPE_SECRET_KEY (or a restricted key with
 * read permissions only) and never exposes the Stripe instance; the interface has no write method,
 * so even a key with wider permissions could not be used for a write from here.
 */
import Stripe from 'stripe'
import type {
  StripeChargeSummary,
  StripeCustomerBundle,
  StripeCustomerSummary,
  StripeDisputeSummary,
  StripeEventSummary,
  StripeInvoiceSummary,
  StripeReadClient,
  StripeRefundSummary,
  StripeSubscriptionSummary,
} from '../types'

type Obj = Record<string, unknown>

const iso = (unix: number | null | undefined): string | null =>
  typeof unix === 'number' ? new Date(unix * 1000).toISOString() : null
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
const idOf = (v: unknown): string | null =>
  typeof v === 'string' ? v : v && typeof v === 'object' ? str((v as Obj).id) : null

export function stripeDashboardUrl(id: string): string {
  const prefix = id.split('_')[0]
  const path: Record<string, string> = {
    cus: 'customers',
    sub: 'subscriptions',
    in: 'invoices',
    ch: 'payments',
    pi: 'payments',
    re: 'refunds',
    dp: 'disputes',
    du: 'disputes',
  }
  return `https://dashboard.stripe.com/${path[prefix!] ?? 'search?query='}${path[prefix!] ? '/' : ''}${id}`
}

function card(source: unknown): { brand: string; last4: string } | null {
  const c = source as Obj | null | undefined
  if (!c) return null
  const brand = str(c.brand)
  const last4 = str(c.last4)
  if (!brand || !last4) return null
  return { brand: brand.charAt(0).toUpperCase() + brand.slice(1), last4 }
}

function customerSummary(c: Stripe.Customer): StripeCustomerSummary {
  const o = c as unknown as Obj
  const pm = (o.invoice_settings as Obj | undefined)?.default_payment_method as Obj | undefined
  const defaultSource = o.default_source as Obj | undefined
  return {
    id: c.id,
    email: c.email ?? null,
    name: c.name ?? null,
    created: iso(c.created)!,
    currency: c.currency ?? null,
    card: card(pm?.card) ?? card(defaultSource) ?? null,
    url: stripeDashboardUrl(c.id),
  }
}

function subscriptionSummary(s: Stripe.Subscription): StripeSubscriptionSummary {
  const o = s as unknown as Obj
  const item = (s.items?.data?.[0] ?? null) as unknown as Obj | null
  const price = (item?.price ?? null) as Obj | null
  const product = price?.product as Obj | string | null | undefined
  const productName = product && typeof product === 'object' ? str(product.name) : null
  const nickname = str(price?.nickname)
  const interval = str((price?.recurring as Obj | undefined)?.interval)
  const plan =
    nickname ??
    (productName
      ? `${productName}${interval ? ` ${interval === 'year' ? 'Yearly' : interval === 'month' ? 'Monthly' : interval}` : ''}`
      : (str(price?.id) ?? 'Subscription'))
  const cd = o.cancellation_details as Obj | undefined
  return {
    id: s.id,
    status: s.status,
    plan,
    interval: (interval as StripeSubscriptionSummary['interval']) ?? null,
    amountCents: num(price?.unit_amount),
    currency: str(price?.currency) ?? s.currency ?? 'usd',
    created: iso(s.created)!,
    // Newer API versions moved the period to the subscription items.
    currentPeriodStart: iso(num(o.current_period_start) ?? num(item?.current_period_start)),
    currentPeriodEnd: iso(num(o.current_period_end) ?? num(item?.current_period_end)),
    cancelAtPeriodEnd: Boolean(s.cancel_at_period_end),
    canceledAt: iso(s.canceled_at),
    endedAt: iso(s.ended_at),
    cancellationReason: cd ? (str(cd.feedback) ?? str(cd.reason) ?? str(cd.comment)) : null,
  }
}

function invoiceSummary(i: Stripe.Invoice): StripeInvoiceSummary {
  const o = i as unknown as Obj
  const parent = o.parent as Obj | undefined
  const subDetails = parent?.subscription_details as Obj | undefined
  return {
    id: i.id ?? '',
    status: i.status ?? null,
    amountDueCents: i.amount_due,
    amountPaidCents: i.amount_paid,
    currency: i.currency,
    created: iso(i.created)!,
    paidAt: iso(i.status_transitions?.paid_at),
    attemptCount: i.attempt_count,
    nextPaymentAttempt: iso(i.next_payment_attempt),
    subscriptionId: idOf(o.subscription) ?? idOf(subDetails?.subscription),
    billingReason: i.billing_reason ?? null,
  }
}

function chargeSummary(c: Stripe.Charge): StripeChargeSummary {
  const o = c as unknown as Obj
  return {
    id: c.id,
    paymentIntentId: idOf(o.payment_intent),
    invoiceId: idOf(o.invoice),
    amountCents: c.amount,
    amountRefundedCents: c.amount_refunded,
    currency: c.currency,
    status: c.status === 'succeeded' ? 'succeeded' : c.status === 'pending' ? 'pending' : 'failed',
    created: iso(c.created)!,
    card: card((c.payment_method_details as unknown as Obj | null)?.card),
    disputed: Boolean(c.disputed),
    failureMessage: c.failure_message ?? null,
    description: c.description ?? null,
  }
}

function refundSummary(r: Stripe.Refund): StripeRefundSummary {
  const o = r as unknown as Obj
  return {
    id: r.id,
    chargeId: idOf(o.charge) ?? '',
    paymentIntentId: idOf(o.payment_intent),
    amountCents: r.amount,
    currency: r.currency,
    status: r.status ?? null,
    reason: r.reason ?? null,
    created: iso(r.created)!,
  }
}

function disputeSummary(d: Stripe.Dispute): StripeDisputeSummary {
  const o = d as unknown as Obj
  return {
    id: d.id,
    chargeId: idOf(o.charge) ?? '',
    amountCents: d.amount,
    currency: d.currency,
    status: d.status,
    reason: d.reason ?? null,
    created: iso(d.created)!,
    evidenceDueBy: iso(d.evidence_details?.due_by)?.slice(0, 10) ?? null,
  }
}

function eventSummary(e: Stripe.Event): StripeEventSummary {
  const obj = (e.data?.object ?? {}) as unknown as Obj
  const amount = num(obj.amount) ?? num(obj.amount_due) ?? num(obj.amount_paid)
  const parts: string[] = [e.type]
  if (amount != null)
    parts.push(`${(amount / 100).toFixed(2)} ${String(obj.currency ?? '').toUpperCase()}`)
  if (str(obj.status)) parts.push(String(obj.status))
  return {
    id: e.id,
    type: e.type,
    created: iso(e.created)!,
    objectId: str(obj.id),
    summary: parts.join(' · '),
  }
}

const EVENT_TYPES = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_succeeded',
  'charge.succeeded',
  'charge.failed',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
]

/** Account-wide events looked at for one customer timeline (Stripe keeps 30 days anyway). */
const EVENTS_SCAN_LIMIT = 2_000
const EVENTS_PER_CUSTOMER_LIMIT = 200

export function createStripeReadClient(readKey: string): StripeReadClient {
  const stripe = new Stripe(readKey, { maxNetworkRetries: 2, timeout: 20_000 })
  return {
    configured: true,
    async findCustomersByEmail(email) {
      const res = await stripe.customers.list({
        email: email.trim().toLowerCase(),
        limit: 5,
        expand: ['data.invoice_settings.default_payment_method'],
      })
      return res.data.map(customerSummary)
    },
    async searchCustomers(query) {
      const q = query.trim().replace(/["\\]/g, ' ').slice(0, 80)
      if (!q) return []
      const clauses = [`name~"${q}"`]
      if (q.includes('@')) clauses.unshift(`email:"${q.toLowerCase()}"`)
      const res = await stripe.customers.search({ query: clauses.join(' OR '), limit: 10 })
      return res.data.map(customerSummary)
    },
    async getCustomer(customerId) {
      const c = await stripe.customers.retrieve(customerId, {
        expand: ['invoice_settings.default_payment_method'],
      })
      if ((c as Stripe.DeletedCustomer).deleted) return null
      return customerSummary(c as Stripe.Customer)
    },
    async listSubscriptions(customerId) {
      // `price` comes expanded by default; `price.product` would be a fifth expand level, which
      // Stripe rejects ("cannot expand more than 4 levels"). Products are fetched by id instead.
      const res = await stripe.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 20,
      })
      const productIds = new Set<string>()
      for (const sub of res.data) {
        for (const item of sub.items?.data ?? []) {
          const product = (item.price as { product?: unknown } | null)?.product
          if (typeof product === 'string') productIds.add(product)
        }
      }
      const products = new Map<string, Stripe.Product>()
      await Promise.all(
        [...productIds].map(async (id) => {
          const product = await stripe.products.retrieve(id).catch(() => null)
          if (product && !(product as { deleted?: boolean }).deleted) products.set(id, product)
        }),
      )
      for (const sub of res.data) {
        for (const item of sub.items?.data ?? []) {
          const price = item.price as { product?: unknown } | null
          if (price && typeof price.product === 'string' && products.has(price.product)) {
            price.product = products.get(price.product)
          }
        }
      }
      return res.data.map(subscriptionSummary)
    },
    async listInvoices(customerId) {
      const res = await stripe.invoices.list({ customer: customerId, limit: 50 })
      return res.data.map(invoiceSummary)
    },
    async listCharges(customerId) {
      const res = await stripe.charges.list({ customer: customerId, limit: 50 })
      return res.data.map(chargeSummary)
    },
    async listRefunds(customerId) {
      const charges = await stripe.charges.list({ customer: customerId, limit: 50 })
      const refunded = charges.data.filter((c) => c.amount_refunded > 0 || c.refunded)
      const lists = await Promise.all(
        refunded.map((c) => stripe.refunds.list({ charge: c.id, limit: 10 })),
      )
      return lists.flatMap((l) => l.data.map(refundSummary))
    },
    async listDisputes(customerId) {
      const charges = await stripe.charges.list({ customer: customerId, limit: 50 })
      const disputed = charges.data.filter((c) => c.disputed)
      const lists = await Promise.all(
        disputed.map((c) => stripe.disputes.list({ charge: c.id, limit: 10 })),
      )
      return lists.flatMap((l) => l.data.map(disputeSummary))
    },
    async listEvents(customerId, days) {
      const gte = Math.floor((Date.now() - days * 86_400_000) / 1000)
      // Events cannot be filtered by customer server-side: page through the window (newest first)
      // and keep the customer's. Bounded so a busy account cannot turn one lookup into a crawl.
      const out: StripeEventSummary[] = []
      let scanned = 0
      for await (const e of stripe.events.list({
        created: { gte },
        types: EVENT_TYPES,
        limit: 100,
      })) {
        scanned++
        if (idOf((e.data?.object as unknown as Obj | undefined)?.customer) === customerId)
          out.push(eventSummary(e))
        if (scanned >= EVENTS_SCAN_LIMIT || out.length >= EVENTS_PER_CUSTOMER_LIMIT) break
      }
      return out.sort((a, b) => a.created.localeCompare(b.created))
    },
    async retrieve(id) {
      const prefix = id.split('_')[0]
      switch (prefix) {
        case 'cus':
          return stripe.customers.retrieve(id)
        case 'sub':
          return stripe.subscriptions.retrieve(id)
        case 'in':
          return stripe.invoices.retrieve(id)
        case 'ch':
          return stripe.charges.retrieve(id)
        case 'pi':
          return stripe.paymentIntents.retrieve(id)
        case 're':
          return stripe.refunds.retrieve(id)
        case 'dp':
        case 'du':
          return stripe.disputes.retrieve(id)
        default:
          throw new Error(`Unsupported Stripe id prefix: ${prefix}`)
      }
    },
  }
}

// ---------------------------------------------------------------- fake

export interface FakeStripeData {
  customers?: StripeCustomerSummary[]
  subscriptions?: (StripeSubscriptionSummary & { customerId: string })[]
  invoices?: (StripeInvoiceSummary & { customerId: string })[]
  charges?: (StripeChargeSummary & { customerId: string })[]
  refunds?: (StripeRefundSummary & { customerId: string })[]
  disputes?: (StripeDisputeSummary & { customerId: string })[]
  events?: (StripeEventSummary & { customerId: string })[]
}

export interface FakeOptions {
  /** Every call throws with this message (simulates an outage). */
  fail?: string
  /** Only these methods throw. */
  failMethods?: string[]
  /** Reports `configured: false` (credentials missing). */
  unconfigured?: boolean
}

export function createFakeStripeReadClient(
  data: FakeStripeData = {},
  opts: FakeOptions = {},
): StripeReadClient & { calls: string[] } {
  const calls: string[] = []
  const guard = (method: string) => {
    calls.push(method)
    if (opts.fail || opts.failMethods?.includes(method))
      throw new Error(opts.fail ?? `stripe ${method} failed (fake)`)
  }
  const byCustomer = <T extends { customerId: string }>(list: T[] | undefined, id: string): T[] =>
    (list ?? []).filter((x) => x.customerId === id)
  return {
    calls,
    configured: !opts.unconfigured,
    async findCustomersByEmail(email) {
      guard('findCustomersByEmail')
      return (data.customers ?? []).filter(
        (c) => c.email?.toLowerCase() === email.trim().toLowerCase(),
      )
    },
    async searchCustomers(query) {
      guard('searchCustomers')
      const q = query.trim().toLowerCase()
      if (!q) return []
      return (data.customers ?? []).filter(
        (c) => c.email?.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q),
      )
    },
    async getCustomer(id) {
      guard('getCustomer')
      return (data.customers ?? []).find((c) => c.id === id) ?? null
    },
    async listSubscriptions(id) {
      guard('listSubscriptions')
      return byCustomer(data.subscriptions, id)
    },
    async listInvoices(id) {
      guard('listInvoices')
      return byCustomer(data.invoices, id)
    },
    async listCharges(id) {
      guard('listCharges')
      return byCustomer(data.charges, id)
    },
    async listRefunds(id) {
      guard('listRefunds')
      return byCustomer(data.refunds, id)
    },
    async listDisputes(id) {
      guard('listDisputes')
      return byCustomer(data.disputes, id)
    },
    async listEvents(id) {
      guard('listEvents')
      return byCustomer(data.events, id)
    },
    async retrieve(id) {
      guard('retrieve')
      const all: { id: string }[] = [
        ...(data.customers ?? []),
        ...(data.subscriptions ?? []),
        ...(data.invoices ?? []),
        ...(data.charges ?? []),
        ...(data.refunds ?? []),
        ...(data.disputes ?? []),
      ]
      const found = all.find((x) => x.id === id)
      if (!found) throw new Error(`No such object: ${id}`)
      return found
    },
  }
}

/**
 * Fetch everything about a customer. Used by the deterministic pre-research. `emails` are the
 * ticket's customer email plus every email mentioned in the thread (a bank writes about its
 * member), `nameHints` are names mentioned next to "member", "customer" or "cardholder".
 */
export async function loadStripeBundle(
  client: StripeReadClient,
  emails: string[],
  knownCustomerId: string | null,
  nameHints: string[] = [],
): Promise<StripeCustomerBundle> {
  let customer = knownCustomerId ? await client.getCustomer(knownCustomerId) : null
  let byEmail: StripeCustomerSummary[] = []
  for (const email of emails) {
    byEmail = await client.findCustomersByEmail(email)
    if (byEmail.length > 0) break
  }
  if (!customer && byEmail.length === 0) {
    for (const name of nameHints) {
      const found = await client.searchCustomers(name)
      if (found.length > 0) {
        byEmail = found
        break
      }
    }
  }
  if (!customer) {
    // The email lookup returns the newest first; prefer the customer with a subscription that is not ended.
    customer = byEmail[0] ?? null
  }
  const otherCustomers = byEmail.filter((c) => c.id !== customer?.id)
  if (!customer) {
    return {
      customer: null,
      otherCustomers,
      subscriptions: [],
      invoices: [],
      charges: [],
      refunds: [],
      disputes: [],
      events: [],
    }
  }
  const [subscriptions, invoices, charges, refunds, disputes, events] = await Promise.all([
    client.listSubscriptions(customer.id),
    client.listInvoices(customer.id),
    client.listCharges(customer.id),
    client.listRefunds(customer.id),
    client.listDisputes(customer.id),
    client.listEvents(customer.id, 400),
  ])
  const byDateDesc = <T extends { created: string }>(l: T[]) =>
    [...l].sort((a, b) => b.created.localeCompare(a.created))
  return {
    customer,
    otherCustomers,
    subscriptions: byDateDesc(subscriptions),
    invoices: byDateDesc(invoices),
    charges: byDateDesc(charges),
    refunds: byDateDesc(refunds),
    disputes: byDateDesc(disputes),
    events: [...events].sort((a, b) => a.created.localeCompare(b.created)),
  }
}
