/**
 * Customer "worlds": the fake Stripe, InstaRadar, Vercel, Linear and Notion data each fixture's
 * read tools answer with. Dates are fixed relative to NOW so the eval is deterministic.
 */
import type { FakeToolsData } from '../../server/agent/tools'
import type { KnowledgeBaseEntry } from '../../server/agent/knowledge/types'
import type {
  LinearIssueSummary,
  LogLine,
  StripeChargeSummary,
  StripeCustomerSummary,
  StripeInvoiceSummary,
  StripeSubscriptionSummary,
} from '../../server/agent/types'

export const NOW = new Date('2026-09-27T10:00:00.000Z')
export const SUPPORT = 'support@instaradar.app'

export const at = (date: string, time = '09:00:00') => `${date}T${time}.000Z`
export const daysAgo = (n: number, time = '09:00:00') =>
  `${new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10)}T${time}.000Z`

export const TPL = {
  cancellation_only: '3e8c931f6ae581429b0ecd9c9abee871',
  cancellation_reason_ask: '3e8c931f6ae58147b800e658bf20d6d7',
  refund_request: '3e8c931f6ae58118a872c601963e97c1',
  chargeback: '3e8c931f6ae5813c8558f2c0427a6037',
  bug_report: '3e8c931f6ae58114beabdeaddfaca242',
  data_accuracy: '3e8c931f6ae581f3b55be4fc0ebd1597',
  feature_request: '3e8c931f6ae581988be7cd93f5d89fd8',
  billing_question: '3e8c931f6ae581c894b8dd9ef534d00f',
  product_question: '3e8c931f6ae58193a3cdd3f12050625a',
  safety_removal: '3e8c931f6ae581ba81e9ee845e3ed1d5',
} as const

export const KB_PAGES = {
  followerCount: '3e8c931f6ae580aa00000000000000a1',
  privateProfiles: '3e8c931f6ae580aa00000000000000a2',
} as const

export const KB_FOLLOWER_COUNT: KnowledgeBaseEntry = {
  notionPageId: KB_PAGES.followerCount,
  url: `https://app.notion.com/p/${KB_PAGES.followerCount}`,
  name: 'Follower count fluctuation',
  category: 'Data accuracy',
  type: 'Explanation',
  status: 'Active',
  app: ['InstaRadar'],
  customerPhrasing: 'The follower count goes up but no new followers show up in the list.',
  shortAnswer:
    'Instagram counts private accounts in the total follower number, but private followers never appear in the visible follower list. The count moves while the list looks unchanged. The list is accurate; it cannot show private accounts.',
  lastVerified: '2026-09-01',
  linearTicket: null,
  relatedTemplateIds: [TPL.data_accuracy],
}

export const KB_PRIVATE_PROFILES: KnowledgeBaseEntry = {
  notionPageId: KB_PAGES.privateProfiles,
  url: `https://app.notion.com/p/${KB_PAGES.privateProfiles}`,
  name: 'Private profiles cannot be tracked',
  category: 'Product',
  type: 'Limitation',
  status: 'Active',
  app: ['InstaRadar'],
  customerPhrasing:
    'The profile I want to track is private. Can I see their followers on a paid plan?',
  shortAnswer:
    'Private profiles cannot be tracked on any plan, even when the customer follows them. InstaRadar only works with information that is publicly visible on Instagram. If the account switches to public, tracking can start right away.',
  lastVerified: '2026-09-01',
  linearTicket: null,
  relatedTemplateIds: [TPL.product_question],
}

export const KB_DRAFT_ENTRY: KnowledgeBaseEntry = {
  ...KB_FOLLOWER_COUNT,
  notionPageId: '3e8c931f6ae580aa00000000000000d1',
  name: 'Draft: scan timing',
  status: 'Draft',
}

export const KB_PAGE_TEXTS: Record<string, string> = {
  [KB_PAGES.followerCount]: `# Follower count fluctuation\n${KB_FOLLOWER_COUNT.shortAnswer}\n- Instagram includes private accounts in the total.\n- The visible list only shows public accounts.\n- Suggest: compare the count with the number of new followers in the list; the gap is private accounts.`,
  [KB_PAGES.privateProfiles]: `# Private profiles cannot be tracked\n${KB_PRIVATE_PROFILES.shortAnswer}`,
}

// ---------------------------------------------------------------- generators

export function customer(
  id: string,
  email: string,
  name: string | null,
  created: string,
  card: { brand: string; last4: string } | null,
): StripeCustomerSummary {
  return {
    id,
    email,
    name,
    created: at(created),
    currency: 'usd',
    card,
    url: `https://dashboard.stripe.com/customers/${id}`,
  }
}

export function subscription(
  o: Partial<StripeSubscriptionSummary> & {
    id: string
    customerId: string
    plan: string
    created: string
  },
): StripeSubscriptionSummary & { customerId: string } {
  return {
    status: 'active',
    interval: o.plan.toLowerCase().includes('year') ? 'year' : 'month',
    amountCents: 799,
    currency: 'usd',
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    endedAt: null,
    cancellationReason: null,
    ...o,
    created: o.created.includes('T') ? o.created : at(o.created),
  }
}

/** One paid invoice + charge per month from `start`, `months` times. */
export function monthlyPayments(o: {
  customerId: string
  subscriptionId: string
  prefix: string
  start: string
  months: number
  amountCents: number
  card: { brand: string; last4: string }
}): {
  invoices: (StripeInvoiceSummary & { customerId: string })[]
  charges: (StripeChargeSummary & { customerId: string })[]
} {
  const invoices: (StripeInvoiceSummary & { customerId: string })[] = []
  const charges: (StripeChargeSummary & { customerId: string })[] = []
  const start = new Date(at(o.start))
  for (let i = 0; i < o.months; i++) {
    const d = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, start.getUTCDate(), 9),
    )
    if (d.getTime() > NOW.getTime()) break
    const iso = d.toISOString()
    const n = String(i + 1).padStart(2, '0')
    invoices.push({
      id: `in_${o.prefix}${n}`,
      customerId: o.customerId,
      status: 'paid',
      amountDueCents: o.amountCents,
      amountPaidCents: o.amountCents,
      currency: 'usd',
      created: iso,
      paidAt: iso,
      attemptCount: 1,
      nextPaymentAttempt: null,
      subscriptionId: o.subscriptionId,
      billingReason: i === 0 ? 'subscription_create' : 'subscription_cycle',
    })
    charges.push({
      id: `ch_${o.prefix}${n}`,
      customerId: o.customerId,
      paymentIntentId: `pi_${o.prefix}${n}`,
      invoiceId: `in_${o.prefix}${n}`,
      amountCents: o.amountCents,
      amountRefundedCents: 0,
      currency: 'usd',
      status: 'succeeded',
      created: iso,
      card: o.card,
      disputed: false,
      failureMessage: null,
      description: `Subscription ${o.subscriptionId}`,
    })
  }
  return { invoices, charges }
}

export function signIns(userId: string, from: string, to: string, count: number) {
  const a = new Date(at(from)).getTime()
  const b = new Date(at(to)).getTime()
  return Array.from({ length: count }, (_, i) => ({
    userId,
    at: new Date(a + ((b - a) * (i + 1)) / (count + 1)).toISOString(),
    action: 'login',
  }))
}

export const LINEAR_ISSUES: LinearIssueSummary[] = [
  {
    id: 'lin_198',
    identifier: 'INS-198',
    title: "False 'post deleted' alerts when Instagram CDN returns 404",
    description:
      'scan-worker treats a media 404 from the Instagram CDN as a deleted post and emits post.deleted. 3 customer reports so far.',
    state: 'In Progress',
    stateType: 'started',
    url: 'https://linear.app/instaradar/issue/INS-198',
    labels: ['Bug'],
    createdAt: at('2026-09-20'),
    updatedAt: at('2026-09-25'),
  },
  {
    id: 'lin_209',
    identifier: 'INS-209',
    title: 'Dark mode for the dashboard',
    description: 'Customers ask for a dark theme at night.',
    state: 'Todo',
    stateType: 'unstarted',
    url: 'https://linear.app/instaradar/issue/INS-209',
    labels: ['Feature'],
    createdAt: at('2026-09-10'),
    updatedAt: at('2026-09-10'),
  },
  {
    id: 'lin_150',
    identifier: 'INS-150',
    title: 'CSV export uses the wrong encoding',
    description: 'Umlauts broken in Excel.',
    state: 'Done',
    stateType: 'completed',
    url: 'https://linear.app/instaradar/issue/INS-150',
    labels: ['Bug'],
    createdAt: at('2026-07-01'),
    updatedAt: at('2026-07-12'),
  },
]

export function scanWorkerLogs(userId: string, handle: string, mediaId: string): LogLine[] {
  const lines: LogLine[] = []
  for (let i = 0; i < 14; i++) {
    const d = new Date(NOW.getTime() - (13 - i) * 86_400_000 * 0.5)
    lines.push({
      at: d.toISOString(),
      level: 'warning',
      source: 'scan-worker',
      message: `media 404 for @${handle}/${mediaId} → emitting post.deleted (user=${userId})`,
      requestId: `req_${i.toString(16).padStart(4, '0')}`,
    })
  }
  for (let i = 0; i < 3; i++) {
    lines.push({
      at: new Date(NOW.getTime() - (5 - i) * 86_400_000).toISOString(),
      level: 'error',
      source: 'scan-worker',
      message: `retry exhausted for media ${mediaId} (user=${userId}, @${handle})`,
      requestId: `req_e${i}`,
    })
  }
  return lines
}

// ---------------------------------------------------------------- worlds

export interface World {
  key: string
  customer: { email: string; name: string | null }
  stripeCustomerId: string | null
  instaradarUserId: string | null
  tools: FakeToolsData
}

const VISA = (last4: string) => ({ brand: 'Visa', last4 })

export function tom(): World {
  const cus = 'cus_TBecker0203'
  const pay = monthlyPayments({
    customerId: cus,
    subscriptionId: 'sub_1PzT8c',
    prefix: 'TBk',
    start: '2026-02-03',
    months: 12,
    amountCents: 799,
    card: VISA('0203'),
  })
  // Renewals fall on the 14th after the first month in the design; keep the first payment on Feb 3.
  return {
    key: 'tom',
    customer: { email: 'tom.becker@web.de', name: 'Tom Becker' },
    stripeCustomerId: cus,
    instaradarUserId: 'usr_tbecker_71c0',
    tools: {
      stripe: {
        customers: [customer(cus, 'tom.becker@web.de', 'Tom Becker', '2026-02-03', VISA('0203'))],
        subscriptions: [
          subscription({
            id: 'sub_1PzT8c',
            customerId: cus,
            plan: 'Pro Monthly',
            created: '2026-02-03',
            amountCents: 799,
            currentPeriodStart: at('2026-09-14'),
            currentPeriodEnd: at('2026-10-14'),
          }),
        ],
        invoices: pay.invoices,
        charges: pay.charges,
      },
      instaradar: {
        users: [
          {
            id: 'usr_tbecker_71c0',
            email: 'tom.becker@web.de',
            plan: 'Pro Monthly',
            status: 'active',
            createdAt: at('2026-02-03'),
            stripeCustomerId: cus,
            lastSignInAt: daysAgo(2),
          },
        ],
        trackedProfiles: [
          {
            userId: 'usr_tbecker_71c0',
            id: 'tp_1',
            handle: 'berlin.eats',
            since: at('2026-02-03'),
            active: true,
          },
          {
            userId: 'usr_tbecker_71c0',
            id: 'tp_2',
            handle: 'tb.runs',
            since: at('2026-03-09'),
            active: true,
          },
        ],
        signIns: signIns('usr_tbecker_71c0', '2026-06-01', '2026-09-25', 12),
        scans: Array.from({ length: 10 }, (_, i) => ({
          userId: 'usr_tbecker_71c0',
          at: daysAgo(i + 1),
          handle: 'berlin.eats',
          status: 'ok',
          error: null,
        })),
      },
      linearIssues: LINEAR_ISSUES,
    },
  }
}

export function marco(): World {
  const cus = 'cus_MBianchi8820'
  const card = { brand: 'Mastercard', last4: '8820' }
  return {
    key: 'marco',
    customer: { email: 'marco.bianchi@libero.it', name: 'Marco Bianchi' },
    stripeCustomerId: cus,
    instaradarUserId: 'usr_mbianchi_9e11',
    tools: {
      stripe: {
        customers: [customer(cus, 'marco.bianchi@libero.it', 'Marco Bianchi', '2026-09-15', card)],
        subscriptions: [
          subscription({
            id: 'sub_1QfA7y',
            customerId: cus,
            plan: 'Pro Monthly',
            created: '2026-09-15',
            amountCents: 1307,
            currentPeriodStart: at('2026-09-15'),
            currentPeriodEnd: at('2026-10-15'),
          }),
        ],
        invoices: [
          {
            id: 'in_1QfA7w',
            customerId: cus,
            status: 'paid',
            amountDueCents: 1307,
            amountPaidCents: 1307,
            currency: 'usd',
            created: at('2026-09-15'),
            paidAt: at('2026-09-15'),
            attemptCount: 1,
            nextPaymentAttempt: null,
            subscriptionId: 'sub_1QfA7y',
            billingReason: 'subscription_create',
          },
        ],
        charges: [
          {
            id: 'ch_3QfA7x',
            customerId: cus,
            paymentIntentId: 'pi_3QfA7x',
            invoiceId: 'in_1QfA7w',
            amountCents: 1307,
            amountRefundedCents: 0,
            currency: 'usd',
            status: 'succeeded',
            created: at('2026-09-15'),
            card,
            disputed: false,
            failureMessage: null,
            description: 'Pro Monthly incl. VAT',
          },
        ],
      },
      instaradar: {
        users: [
          {
            id: 'usr_mbianchi_9e11',
            email: 'marco.bianchi@libero.it',
            plan: 'Pro Monthly',
            status: 'active',
            createdAt: at('2026-09-15'),
            stripeCustomerId: cus,
            lastSignInAt: daysAgo(1),
          },
        ],
        trackedProfiles: [
          {
            userId: 'usr_mbianchi_9e11',
            id: 'tp_m1',
            handle: 'marcobianchi',
            since: at('2026-09-15'),
            active: true,
          },
          {
            userId: 'usr_mbianchi_9e11',
            id: 'tp_m2',
            handle: 'trattoria.nonna',
            since: at('2026-09-15'),
            active: true,
          },
          {
            userId: 'usr_mbianchi_9e11',
            id: 'tp_m3',
            handle: 'mb.photo',
            since: at('2026-09-16'),
            active: true,
          },
          {
            userId: 'usr_mbianchi_9e11',
            id: 'tp_m4',
            handle: 'fc.lecco',
            since: at('2026-09-18'),
            active: true,
          },
        ],
        signIns: signIns('usr_mbianchi_9e11', '2026-09-15', '2026-09-26', 5),
      },
      linearIssues: LINEAR_ISSUES,
    },
  }
}

export function rachel(): World {
  const cus = 'cus_RKim4417'
  const card = VISA('4417')
  const charge = (
    id: string,
    pi: string,
    inv: string,
    date: string,
    cents: number,
    disputed: boolean,
    sub: string,
  ): StripeChargeSummary & { customerId: string } => ({
    id,
    customerId: cus,
    paymentIntentId: pi,
    invoiceId: inv,
    amountCents: cents,
    amountRefundedCents: 0,
    currency: 'usd',
    status: 'succeeded',
    created: at(date),
    card,
    disputed,
    failureMessage: null,
    description: `Subscription ${sub}`,
  })
  const invoice = (
    id: string,
    date: string,
    cents: number,
    sub: string,
  ): StripeInvoiceSummary & { customerId: string } => ({
    id,
    customerId: cus,
    status: 'paid',
    amountDueCents: cents,
    amountPaidCents: cents,
    currency: 'usd',
    created: at(date),
    paidAt: at(date),
    attemptCount: 1,
    nextPaymentAttempt: null,
    subscriptionId: sub,
    billingReason: 'subscription_cycle',
  })
  return {
    key: 'rachel',
    customer: { email: 'rachel.kim@gmail.com', name: 'Rachel Kim' },
    stripeCustomerId: cus,
    instaradarUserId: 'usr_rkim_2f9a',
    tools: {
      stripe: {
        customers: [customer(cus, 'rachel.kim@gmail.com', 'Rachel Kim', '2026-01-12', card)],
        subscriptions: [
          subscription({
            id: 'sub_1OxK2a',
            customerId: cus,
            plan: 'Pro Monthly',
            created: '2026-01-12',
            status: 'canceled',
            amountCents: 799,
            canceledAt: at('2026-03-18'),
            endedAt: at('2026-03-18'),
            cancellationReason: 'unused',
          }),
          subscription({
            id: 'sub_1P3mQe',
            customerId: cus,
            plan: 'Pro Monthly',
            created: '2026-04-04',
            status: 'canceled',
            amountCents: 799,
            canceledAt: at('2026-08-02'),
            endedAt: at('2026-08-02'),
            cancellationReason: null,
          }),
        ],
        invoices: [
          invoice('in_RK01', '2026-01-12', 799, 'sub_1OxK2a'),
          invoice('in_RK02', '2026-02-12', 799, 'sub_1OxK2a'),
          invoice('in_RK03', '2026-04-04', 499, 'sub_1P3mQe'),
          invoice('in_RK04', '2026-05-04', 799, 'sub_1P3mQe'),
          invoice('in_RK05', '2026-06-04', 799, 'sub_1P3mQe'),
          invoice('in_RK06', '2026-07-04', 799, 'sub_1P3mQe'),
        ],
        charges: [
          charge('ch_RK01', 'pi_RK01', 'in_RK01', '2026-01-12', 799, false, 'sub_1OxK2a'),
          charge('ch_RK02', 'pi_RK02', 'in_RK02', '2026-02-12', 799, false, 'sub_1OxK2a'),
          charge('ch_RK03', 'pi_RK03', 'in_RK03', '2026-04-04', 499, false, 'sub_1P3mQe'),
          charge('ch_3PqL', 'pi_3PqL', 'in_RK04', '2026-05-04', 799, true, 'sub_1P3mQe'),
          charge('ch_3Q1n', 'pi_3Q1n', 'in_RK05', '2026-06-04', 799, true, 'sub_1P3mQe'),
          charge('ch_3QbZ', 'pi_3QbZ', 'in_RK06', '2026-07-04', 799, true, 'sub_1P3mQe'),
        ],
        disputes: ['ch_3PqL', 'ch_3Q1n', 'ch_3QbZ'].map((ch, i) => ({
          id: `dp_RK${i + 1}`,
          customerId: cus,
          chargeId: ch,
          amountCents: 799,
          currency: 'usd',
          status: 'needs_response',
          reason: 'subscription_canceled',
          created: at('2026-08-29', '07:40:00'),
          evidenceDueBy: '2026-10-09',
        })),
        events: [
          {
            customerId: cus,
            id: 'evt_1',
            type: 'customer.subscription.created',
            created: at('2026-01-12'),
            objectId: 'sub_1OxK2a',
            summary: 'customer.subscription.created · Pro Monthly',
          },
          {
            customerId: cus,
            id: 'evt_2',
            type: 'customer.subscription.deleted',
            created: at('2026-03-18', '09:14:00'),
            objectId: 'sub_1OxK2a',
            summary: 'customer.subscription.deleted',
          },
          {
            customerId: cus,
            id: 'evt_3',
            type: 'customer.subscription.created',
            created: at('2026-04-04', '18:52:00'),
            objectId: 'sub_1P3mQe',
            summary: 'customer.subscription.created · Basic',
          },
          {
            customerId: cus,
            id: 'evt_4',
            type: 'customer.subscription.updated',
            created: at('2026-04-20', '11:03:00'),
            objectId: 'sub_1P3mQe',
            summary: 'customer.subscription.updated · basic → pro',
          },
          {
            customerId: cus,
            id: 'evt_5',
            type: 'charge.succeeded',
            created: at('2026-05-04'),
            objectId: 'ch_3PqL',
            summary: 'charge.succeeded · 7.99 USD',
          },
          {
            customerId: cus,
            id: 'evt_6',
            type: 'charge.succeeded',
            created: at('2026-06-04'),
            objectId: 'ch_3Q1n',
            summary: 'charge.succeeded · 7.99 USD',
          },
          {
            customerId: cus,
            id: 'evt_7',
            type: 'charge.succeeded',
            created: at('2026-07-04'),
            objectId: 'ch_3QbZ',
            summary: 'charge.succeeded · 7.99 USD',
          },
          {
            customerId: cus,
            id: 'evt_8',
            type: 'customer.subscription.deleted',
            created: at('2026-08-02'),
            objectId: 'sub_1P3mQe',
            summary: 'customer.subscription.deleted',
          },
          {
            customerId: cus,
            id: 'evt_9',
            type: 'charge.dispute.created',
            created: at('2026-08-29', '07:40:00'),
            objectId: 'dp_RK1',
            summary: 'charge.dispute.created · 3 × 7.99 USD',
          },
        ],
      },
      instaradar: {
        users: [
          {
            id: 'usr_rkim_2f9a',
            email: 'rachel.kim@gmail.com',
            plan: 'Pro Monthly',
            status: 'canceled',
            createdAt: at('2026-01-12'),
            stripeCustomerId: cus,
            lastSignInAt: at('2026-08-30'),
          },
        ],
        trackedProfiles: [
          {
            userId: 'usr_rkim_2f9a',
            id: 'tp_r1',
            handle: 'kimbakes.co',
            since: at('2026-04-04'),
            active: true,
          },
          {
            userId: 'usr_rkim_2f9a',
            id: 'tp_r2',
            handle: 'lunchbox.rk',
            since: at('2026-04-06'),
            active: true,
          },
        ],
        signIns: signIns('usr_rkim_2f9a', '2026-05-01', '2026-08-30', 41),
      },
      linearIssues: LINEAR_ISSUES,
    },
  }
}

export function priya(): World {
  const cus = 'cus_PNair1009'
  const card = { brand: 'Amex', last4: '1009' }
  const pay = monthlyPayments({
    customerId: cus,
    subscriptionId: 'sub_1PNairY',
    prefix: 'PNy',
    start: '2024-11-02',
    months: 1,
    amountCents: 17_900,
    card,
  })
  const renewal = monthlyPayments({
    customerId: cus,
    subscriptionId: 'sub_1PNairY',
    prefix: 'PNz',
    start: '2025-11-02',
    months: 1,
    amountCents: 17_900,
    card,
  })
  return {
    key: 'priya',
    customer: { email: 'priya.nair@gmail.com', name: 'Priya Nair' },
    stripeCustomerId: cus,
    instaradarUserId: 'usr_pnair_0b7d',
    tools: {
      stripe: {
        customers: [customer(cus, 'priya.nair@gmail.com', 'Priya Nair', '2024-11-02', card)],
        subscriptions: [
          subscription({
            id: 'sub_1PNairY',
            customerId: cus,
            plan: 'Business Yearly',
            created: '2024-11-02',
            amountCents: 17_900,
            interval: 'year',
            currentPeriodStart: at('2025-11-02'),
            currentPeriodEnd: at('2026-11-02'),
          }),
        ],
        invoices: [...pay.invoices, ...renewal.invoices],
        charges: [...pay.charges, ...renewal.charges],
      },
      instaradar: {
        users: [
          {
            id: 'usr_pnair_0b7d',
            email: 'priya.nair@gmail.com',
            plan: 'Business Yearly',
            status: 'active',
            createdAt: at('2024-11-02'),
            stripeCustomerId: cus,
            lastSignInAt: daysAgo(0, '07:10:00'),
          },
        ],
        trackedProfiles: [
          {
            userId: 'usr_pnair_0b7d',
            id: 'tp_p1',
            handle: 'studio.kolo',
            since: at('2024-11-02'),
            active: true,
          },
          {
            userId: 'usr_pnair_0b7d',
            id: 'tp_p2',
            handle: 'kolo.ceramics',
            since: at('2024-11-02'),
            active: true,
          },
          {
            userId: 'usr_pnair_0b7d',
            id: 'tp_p3',
            handle: 'priya.makes',
            since: at('2025-01-15'),
            active: true,
          },
        ],
        signIns: signIns('usr_pnair_0b7d', '2026-06-01', '2026-09-26', 60),
        alerts: Array.from({ length: 6 }, (_, i) => ({
          userId: 'usr_pnair_0b7d',
          at: daysAgo(i + 1, '06:15:00'),
          handle: 'studio.kolo',
          type: 'post_deleted',
        })),
        scans: Array.from({ length: 14 }, (_, i) => ({
          userId: 'usr_pnair_0b7d',
          at: daysAgo(i, '06:14:00'),
          handle: 'studio.kolo',
          status: i < 3 ? 'error' : 'ok',
          error: i < 3 ? 'retry exhausted for media 3199004' : null,
        })),
      },
      vercelLogs: scanWorkerLogs('usr_pnair_0b7d', 'studio.kolo', '3199004'),
      linearIssues: LINEAR_ISSUES,
    },
  }
}

export function liam(): World {
  const cus = 'cus_LChen3344'
  const pay = monthlyPayments({
    customerId: cus,
    subscriptionId: 'sub_1LChen',
    prefix: 'LCh',
    start: '2026-06-10',
    months: 6,
    amountCents: 799,
    card: VISA('3344'),
  })
  return {
    key: 'liam',
    customer: { email: 'liam.chen@icloud.com', name: 'Liam Chen' },
    stripeCustomerId: cus,
    instaradarUserId: 'usr_lchen_77aa',
    tools: {
      stripe: {
        customers: [customer(cus, 'liam.chen@icloud.com', 'Liam Chen', '2026-06-10', VISA('3344'))],
        subscriptions: [
          subscription({
            id: 'sub_1LChen',
            customerId: cus,
            plan: 'Pro Monthly',
            created: '2026-06-10',
            currentPeriodStart: at('2026-09-10'),
            currentPeriodEnd: at('2026-10-10'),
          }),
        ],
        invoices: pay.invoices,
        charges: pay.charges,
      },
      instaradar: {
        users: [
          {
            id: 'usr_lchen_77aa',
            email: 'liam.chen@icloud.com',
            plan: 'Pro Monthly',
            status: 'active',
            createdAt: at('2026-06-10'),
            stripeCustomerId: cus,
            lastSignInAt: daysAgo(1),
          },
        ],
        trackedProfiles: [
          {
            userId: 'usr_lchen_77aa',
            id: 'tp_l1',
            handle: 'chen.captures',
            since: at('2026-06-10'),
            active: true,
          },
        ],
        signIns: signIns('usr_lchen_77aa', '2026-06-10', '2026-09-26', 20),
      },
      linearIssues: LINEAR_ISSUES,
    },
  }
}

export function sara(): World {
  return {
    key: 'sara',
    customer: { email: 'sara.lindqvist@gmail.com', name: 'Sara Lindqvist' },
    stripeCustomerId: null,
    instaradarUserId: null,
    tools: {
      stripe: {},
      instaradar: { profiles: [{ handle: 'sara.lindqvist', trackedByUsers: 3, blocked: false }] },
      linearIssues: LINEAR_ISSUES,
    },
  }
}

export function jonas(): World {
  const cus = 'cus_JWeber3310'
  const pay = monthlyPayments({
    customerId: cus,
    subscriptionId: 'sub_1JWeber',
    prefix: 'JWb',
    start: '2026-07-03',
    months: 4,
    amountCents: 499,
    card: VISA('3310'),
  })
  return {
    key: 'jonas',
    customer: { email: 'jonas.weber@gmx.net', name: 'Jonas Weber' },
    stripeCustomerId: cus,
    instaradarUserId: 'usr_jweber_5a2c',
    tools: {
      stripe: {
        customers: [
          customer(cus, 'jonas.weber@gmx.net', 'Jonas Weber', '2026-07-03', VISA('3310')),
        ],
        subscriptions: [
          subscription({
            id: 'sub_1JWeber',
            customerId: cus,
            plan: 'Basic Monthly',
            created: '2026-07-03',
            amountCents: 499,
            currentPeriodStart: at('2026-09-03'),
            currentPeriodEnd: at('2026-10-03'),
          }),
        ],
        invoices: pay.invoices,
        charges: pay.charges,
      },
      instaradar: {
        users: [
          {
            id: 'usr_jweber_5a2c',
            email: 'jonas.weber@gmx.net',
            plan: 'Basic Monthly',
            status: 'active',
            createdAt: at('2026-07-03'),
            stripeCustomerId: cus,
            lastSignInAt: daysAgo(0),
          },
        ],
        trackedProfiles: [
          {
            userId: 'usr_jweber_5a2c',
            id: 'tp_j1',
            handle: 'weber.woodworks',
            since: at('2026-07-03'),
            active: true,
          },
        ],
        signIns: signIns('usr_jweber_5a2c', '2026-07-03', '2026-09-26', 30),
        scans: Array.from({ length: 14 }, (_, i) => ({
          userId: 'usr_jweber_5a2c',
          at: daysAgo(i, '05:00:00'),
          handle: 'weber.woodworks',
          status: 'ok',
          error: null,
        })),
        selects: [
          {
            match: 'follower',
            result: {
              columns: ['week', 'new_followers_total', 'new_followers_visible', 'private_accounts'],
              rows: [
                {
                  week: '2026-W39',
                  new_followers_total: 38,
                  new_followers_visible: 7,
                  private_accounts: 31,
                },
              ],
              rowCount: 1,
              truncated: false,
            },
          },
        ],
      },
      notion: { pages: KB_PAGE_TEXTS },
      linearIssues: LINEAR_ISSUES,
    },
  }
}

export function nina(): World {
  const cus = 'cus_NPetrova5511'
  const pay = monthlyPayments({
    customerId: cus,
    subscriptionId: 'sub_1NPetr',
    prefix: 'NPt',
    start: '2026-05-20',
    months: 6,
    amountCents: 799,
    card: VISA('5511'),
  })
  return {
    key: 'nina',
    customer: { email: 'nina.petrova@gmail.com', name: 'Nina Petrova' },
    stripeCustomerId: cus,
    instaradarUserId: 'usr_npetrova_1c2d',
    tools: {
      stripe: {
        customers: [
          customer(cus, 'nina.petrova@gmail.com', 'Nina Petrova', '2026-05-20', VISA('5511')),
        ],
        subscriptions: [
          subscription({
            id: 'sub_1NPetr',
            customerId: cus,
            plan: 'Pro Monthly',
            created: '2026-05-20',
            cancelAtPeriodEnd: true,
            canceledAt: at('2026-09-26'),
            currentPeriodStart: at('2026-09-20'),
            currentPeriodEnd: at('2026-10-20'),
            cancellationReason: 'low_quality',
          }),
        ],
        invoices: pay.invoices,
        charges: pay.charges,
      },
      instaradar: {
        users: [
          {
            id: 'usr_npetrova_1c2d',
            email: 'nina.petrova@gmail.com',
            plan: 'Pro Monthly',
            status: 'active',
            createdAt: at('2026-05-20'),
            stripeCustomerId: cus,
            lastSignInAt: daysAgo(1),
          },
        ],
        trackedProfiles: [
          {
            userId: 'usr_npetrova_1c2d',
            id: 'tp_n1',
            handle: 'petrova.art',
            since: at('2026-05-20'),
            active: true,
          },
        ],
        signIns: signIns('usr_npetrova_1c2d', '2026-06-01', '2026-09-26', 18),
      },
      notion: { pages: KB_PAGE_TEXTS },
      linearIssues: LINEAR_ISSUES,
    },
  }
}

export function kate(): World {
  const cus = 'cus_KMorgan5540'
  const card = VISA('5540')
  const regular = monthlyPayments({
    customerId: cus,
    subscriptionId: 'sub_1KMorg',
    prefix: 'KMg',
    start: '2026-04-21',
    months: 3,
    amountCents: 799,
    card,
  })
  const catchUp = (n: string, invoiceDate: string, paidDate: string, attempts: number) => ({
    invoice: {
      id: `in_KM${n}`,
      customerId: cus,
      status: 'paid',
      amountDueCents: 799,
      amountPaidCents: 799,
      currency: 'usd',
      created: at(invoiceDate),
      paidAt: at(paidDate),
      attemptCount: attempts,
      nextPaymentAttempt: null,
      subscriptionId: 'sub_1KMorg',
      billingReason: 'subscription_cycle',
    } as StripeInvoiceSummary & { customerId: string },
    failed: {
      id: `ch_KM${n}f`,
      customerId: cus,
      paymentIntentId: `pi_KM${n}f`,
      invoiceId: `in_KM${n}`,
      amountCents: 799,
      amountRefundedCents: 0,
      currency: 'usd',
      status: 'failed',
      created: at(invoiceDate),
      card,
      disputed: false,
      failureMessage: 'Your card was declined.',
      description: 'Subscription sub_1KMorg',
    } as StripeChargeSummary & { customerId: string },
    paid: {
      id: `ch_KM${n}p`,
      customerId: cus,
      paymentIntentId: `pi_KM${n}p`,
      invoiceId: `in_KM${n}`,
      amountCents: 799,
      amountRefundedCents: 0,
      currency: 'usd',
      status: 'succeeded',
      created: at(paidDate),
      card,
      disputed: false,
      failureMessage: null,
      description: 'Subscription sub_1KMorg',
    } as StripeChargeSummary & { customerId: string },
  })
  const jul = catchUp('07', '2026-07-21', '2026-09-17', 4)
  const aug = catchUp('08', '2026-08-21', '2026-09-19', 3)
  const sep = monthlyPayments({
    customerId: cus,
    subscriptionId: 'sub_1KMorg',
    prefix: 'KMs',
    start: '2026-09-21',
    months: 1,
    amountCents: 799,
    card,
  })
  return {
    key: 'kate',
    customer: { email: 'kate.morgan@yahoo.com', name: 'Kate Morgan' },
    stripeCustomerId: cus,
    instaradarUserId: 'usr_kmorgan_c1e8',
    tools: {
      stripe: {
        customers: [customer(cus, 'kate.morgan@yahoo.com', 'Kate Morgan', '2026-04-21', card)],
        subscriptions: [
          subscription({
            id: 'sub_1KMorg',
            customerId: cus,
            plan: 'Pro Monthly',
            created: '2026-04-21',
            currentPeriodStart: at('2026-09-21'),
            currentPeriodEnd: at('2026-10-21'),
          }),
        ],
        invoices: [...regular.invoices, jul.invoice, aug.invoice, ...sep.invoices],
        charges: [...regular.charges, jul.failed, jul.paid, aug.failed, aug.paid, ...sep.charges],
      },
      instaradar: {
        users: [
          {
            id: 'usr_kmorgan_c1e8',
            email: 'kate.morgan@yahoo.com',
            plan: 'Pro Monthly',
            status: 'active',
            createdAt: at('2026-04-21'),
            stripeCustomerId: cus,
            lastSignInAt: daysAgo(3),
          },
        ],
        trackedProfiles: [
          {
            userId: 'usr_kmorgan_c1e8',
            id: 'tp_k1',
            handle: 'kate.morgan.art',
            since: at('2026-04-21'),
            active: true,
          },
        ],
        signIns: signIns('usr_kmorgan_c1e8', '2026-06-01', '2026-09-26', 9),
      },
      linearIssues: LINEAR_ISSUES,
    },
  }
}

export function ben(): World {
  const cus = 'cus_BCarter9090'
  const pay = monthlyPayments({
    customerId: cus,
    subscriptionId: 'sub_1BCart',
    prefix: 'BCa',
    start: '2026-09-20',
    months: 1,
    amountCents: 799,
    card: VISA('9090'),
  })
  return {
    key: 'ben',
    customer: { email: 'ben.carter@proton.me', name: 'Ben Carter' },
    stripeCustomerId: cus,
    instaradarUserId: 'usr_bcarter_3e3e',
    tools: {
      stripe: {
        customers: [
          customer(cus, 'ben.carter@proton.me', 'Ben Carter', '2026-09-20', VISA('9090')),
        ],
        subscriptions: [
          subscription({
            id: 'sub_1BCart',
            customerId: cus,
            plan: 'Pro Monthly',
            created: '2026-09-20',
            currentPeriodStart: at('2026-09-20'),
            currentPeriodEnd: at('2026-10-20'),
          }),
        ],
        invoices: pay.invoices,
        charges: pay.charges,
      },
      instaradar: {
        users: [
          {
            id: 'usr_bcarter_3e3e',
            email: 'ben.carter@proton.me',
            plan: 'Pro Monthly',
            status: 'active',
            createdAt: at('2026-09-20'),
            stripeCustomerId: cus,
            lastSignInAt: daysAgo(0),
          },
        ],
        trackedProfiles: [],
        signIns: signIns('usr_bcarter_3e3e', '2026-09-20', '2026-09-26', 3),
      },
      notion: { pages: KB_PAGE_TEXTS },
      linearIssues: LINEAR_ISSUES,
    },
  }
}
