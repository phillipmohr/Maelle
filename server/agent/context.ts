/**
 * Customer facts and the context panel snapshot, built by deterministic code from the research
 * bundle (never by the model). `CustomerFacts` also feeds the policy guardrails and the hints the
 * model gets.
 */
import type { CustomerContext, CustomerContextTimelineEntry, TicketRow } from '#shared/api'
import { money } from './attachments/stripe-timeline'
import type {
  LogLine,
  ResearchBundle,
  StripeChargeSummary,
  StripeDisputeSummary,
  StripeRefundSummary,
  StripeSubscriptionSummary,
} from './types'

export interface LatestPayment {
  chargeId: string
  paymentIntentId: string | null
  amountCents: number
  currency: string
  date: string
  cardLabel: string | null
}

export interface CustomerFacts {
  stripeCustomerId: string | null
  instaradarUserId: string | null
  customerName: string | null
  plan: string | null
  subscriptionStatus: string | null
  activeSubscription: StripeSubscriptionSummary | null
  latestSubscription: StripeSubscriptionSummary | null
  renewalDate: string | null
  accessUntil: string | null
  cancellationDate: string | null
  customerSince: string | null
  customerDays: number | null
  card: { brand: string; last4: string } | null
  cardLabel: string | null
  latestPayment: LatestPayment | null
  daysSinceLatestPayment: number | null
  payments: StripeChargeSummary[]
  refunds: StripeRefundSummary[]
  refundCount: number
  openDisputes: StripeDisputeSummary[]
  latestChargeDisputed: boolean
  failedPayments: number
  openInvoices: number
  catchUpPayments: number
  subscriptionsCount: number
  resubscribed: boolean
  trackedProfiles: { handle: string; since: string }[]
  signIns: number
  lastSignInAt: string | null
  logErrors: { text: string; count: number }[] | null
  previousTickets: number
  isLongTerm: boolean
  isNewCustomer: boolean
  tags: string[]
}

const DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Sep 15" in the current year, "Nov 2, 2024" otherwise. */
export function shortDate(iso: string, now: Date): string {
  const d = new Date(iso)
  const s = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
  return d.getUTCFullYear() === now.getUTCFullYear() ? s : `${s}, ${d.getUTCFullYear()}`
}

/** "September 15, 2026" for replies. */
export function longDate(iso: string): string {
  const d = new Date(iso)
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

export const isoDate = (iso: string) => iso.slice(0, 10)

/** Groups error/warning log lines by their message with ids and numbers stripped. */
export function groupLogErrors(lines: LogLine[]): { text: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const l of lines) {
    if (l.level !== 'error' && l.level !== 'warning') continue
    const key = l.message
      .replace(/https?:\/\/\S+/g, '<url>')
      .replace(/@[a-z0-9._]+/gi, '@<handle>')
      .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<id>')
      .replace(/\b\d{4,}\b/g, '<n>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([text, count]) => ({ text, count }))
}

const STATUS_RANK: Record<string, number> = {
  active: 0,
  trialing: 1,
  past_due: 2,
  unpaid: 3,
  paused: 4,
  incomplete: 5,
  canceled: 6,
  incomplete_expired: 7,
}

export function deriveFacts(
  ticket: Pick<TicketRow, 'customerName' | 'instaradarUserId' | 'stripeCustomerId'>,
  research: ResearchBundle,
  now: Date,
): CustomerFacts {
  const stripe = research.stripe.data
  const ir = research.supabase.data
  const subs = [...(stripe?.subscriptions ?? [])].sort(
    (a, b) =>
      (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
      b.created.localeCompare(a.created),
  )
  const activeSubscription =
    subs.find((s) => ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(s.status)) ??
    null
  const latestSubscription =
    [...(stripe?.subscriptions ?? [])].sort((a, b) => b.created.localeCompare(a.created))[0] ?? null
  const payments = (stripe?.charges ?? []).filter((c) => c.status === 'succeeded')
  const latestCharge = payments[0] ?? null
  const cardOf = (c: { brand: string; last4: string } | null) =>
    c ? `${c.brand} ··${c.last4}` : null
  const card = latestCharge?.card ?? stripe?.customer?.card ?? null
  const latestPayment: LatestPayment | null = latestCharge
    ? {
        chargeId: latestCharge.id,
        paymentIntentId: latestCharge.paymentIntentId,
        amountCents: latestCharge.amountCents,
        currency: latestCharge.currency,
        date: latestCharge.created,
        cardLabel: cardOf(latestCharge.card),
      }
    : null
  const refunds = stripe?.refunds ?? []
  const disputes = stripe?.disputes ?? []
  const openDisputes = disputes.filter((d) => !['won', 'lost', 'warning_closed'].includes(d.status))
  const invoices = stripe?.invoices ?? []
  const customerSinceIso =
    stripe?.customer?.created ??
    ir?.user?.createdAt ??
    [...(stripe?.subscriptions ?? [])].sort((a, b) => a.created.localeCompare(b.created))[0]
      ?.created ??
    null
  const customerDays = customerSinceIso
    ? Math.floor((now.getTime() - new Date(customerSinceIso).getTime()) / DAY)
    : null
  const sortedByCreated = [...(stripe?.subscriptions ?? [])].sort((a, b) =>
    a.created.localeCompare(b.created),
  )
  const resubscribed = sortedByCreated.some((s, i) => {
    const prev = sortedByCreated[i - 1]
    return (
      prev && (prev.endedAt || prev.canceledAt) && s.created > (prev.endedAt ?? prev.canceledAt!)
    )
  })
  const catchUpPayments = invoices.filter(
    (i) => i.status === 'paid' && i.attemptCount > 1 && i.amountPaidCents > 0,
  ).length
  const logErrors =
    research.vercel.status === 'ok' && research.vercel.data
      ? groupLogErrors(research.vercel.data)
      : null
  const isLongTerm = customerDays != null && customerDays >= 180
  const isNewCustomer = customerDays != null && customerDays < 30
  const plan = activeSubscription?.plan ?? latestSubscription?.plan ?? ir?.user?.plan ?? null

  const tags: string[] = []
  if (isLongTerm) tags.push('Long-term')
  if (isNewCustomer) tags.push('New customer')
  if (refunds.length > 0) tags.push('Refund used')
  if (resubscribed) tags.push('Resubscribed')
  if (plan && /business/i.test(plan)) tags.push('Business plan')
  if (plan && /year/i.test(plan)) tags.push('Yearly')
  if (openDisputes.length > 0) tags.push('Dispute open')
  if (invoices.some((i) => i.status === 'open' && i.attemptCount > 0)) tags.push('Failed payments')
  if (activeSubscription?.cancelAtPeriodEnd) tags.push('Cancelling')
  if (!activeSubscription && latestSubscription?.status === 'canceled') tags.push('Cancelled')

  return {
    stripeCustomerId: stripe?.customer?.id ?? ticket.stripeCustomerId ?? null,
    instaradarUserId: ir?.user?.id ?? ticket.instaradarUserId ?? null,
    customerName: stripe?.customer?.name ?? ticket.customerName ?? null,
    plan,
    subscriptionStatus:
      activeSubscription?.status ??
      latestSubscription?.status ??
      (stripe?.customer ? 'none' : null),
    activeSubscription,
    latestSubscription,
    renewalDate:
      activeSubscription && !activeSubscription.cancelAtPeriodEnd
        ? activeSubscription.currentPeriodEnd
        : null,
    accessUntil: activeSubscription?.currentPeriodEnd ?? null,
    cancellationDate:
      activeSubscription?.cancelAtPeriodEnd && activeSubscription.currentPeriodEnd
        ? activeSubscription.currentPeriodEnd
        : (latestSubscription?.endedAt ?? latestSubscription?.canceledAt ?? null),
    customerSince: customerSinceIso,
    customerDays,
    card,
    cardLabel: cardOf(card),
    latestPayment,
    daysSinceLatestPayment: latestPayment
      ? Math.floor((now.getTime() - new Date(latestPayment.date).getTime()) / DAY)
      : null,
    payments,
    refunds,
    refundCount: refunds.length,
    openDisputes,
    latestChargeDisputed: latestCharge?.disputed ?? false,
    failedPayments: (stripe?.charges ?? []).filter((c) => c.status === 'failed').length,
    openInvoices: invoices.filter((i) => i.status === 'open').length,
    catchUpPayments,
    subscriptionsCount: stripe?.subscriptions.length ?? 0,
    resubscribed,
    trackedProfiles: (ir?.trackedProfiles ?? [])
      .filter((p) => p.active)
      .map((p) => ({ handle: p.handle, since: p.since })),
    signIns: ir?.signIns.length ?? 0,
    lastSignInAt: ir?.user?.lastSignInAt ?? ir?.signIns[0]?.at ?? null,
    logErrors,
    previousTickets: research.email.data?.length ?? 0,
    isLongTerm,
    isNewCustomer,
    tags,
  }
}

export function buildCustomerContext(
  facts: CustomerFacts,
  research: ResearchBundle,
  now: Date,
  opts: { customerName?: string | null; previousTickets?: CustomerContext['previousTickets'] } = {},
): CustomerContext {
  const plan: CustomerContext['plan'] = []
  plan.push({ label: 'Plan', value: facts.plan ?? 'No subscription' })
  const sub = facts.activeSubscription ?? facts.latestSubscription
  if (sub) {
    let status = sub.status.charAt(0).toUpperCase() + sub.status.slice(1).replace(/_/g, ' ')
    if (sub.status === 'canceled' && (sub.endedAt || sub.canceledAt))
      status = `Cancelled ${shortDate(sub.endedAt ?? sub.canceledAt!, now)}`
    else if (sub.cancelAtPeriodEnd && sub.currentPeriodEnd)
      status = `Cancels ${shortDate(sub.currentPeriodEnd, now)}`
    plan.push({ label: 'Status', value: status })
    if (facts.renewalDate) plan.push({ label: 'Renews', value: longDate(facts.renewalDate) })
  } else {
    plan.push({
      label: 'Status',
      value: research.stripe.status === 'ok' ? 'No subscription' : 'Unknown',
    })
  }
  if (facts.customerSince)
    plan.push({ label: 'Customer since', value: longDate(facts.customerSince) })
  if (facts.cardLabel) plan.push({ label: 'Card', value: facts.cardLabel, mono: true })

  const timeline: CustomerContextTimelineEntry[] = []
  const stripe = research.stripe.data
  if (stripe) {
    const invoiceById = new Map(stripe.invoices.map((i) => [i.id, i]))
    for (const s of stripe.subscriptions) {
      timeline.push({
        date: shortDate(s.created, now),
        label: `Subscribed · ${s.plan}`,
        amount: s.amountCents != null ? money(s.amountCents, s.currency) : null,
        kind: 'default',
      })
      if (s.endedAt || s.canceledAt)
        timeline.push({
          date: shortDate(s.endedAt ?? s.canceledAt!, now),
          label: s.cancelAtPeriodEnd && !s.endedAt ? 'Cancellation scheduled' : 'Cancelled',
          amount: null,
          kind: 'muted',
        })
    }
    for (const c of stripe.charges) {
      const inv = c.invoiceId ? invoiceById.get(c.invoiceId) : undefined
      if (c.status === 'failed') {
        timeline.push({
          date: shortDate(c.created, now),
          label: 'Payment failed',
          amount: money(c.amountCents, c.currency),
          kind: 'muted',
        })
      } else if (c.disputed) {
        timeline.push({
          date: shortDate(c.created, now),
          label: 'Charge · disputed',
          amount: money(c.amountCents, c.currency),
          kind: 'bad',
        })
      } else if (inv && inv.attemptCount > 1) {
        timeline.push({
          date: shortDate(c.created, now),
          label: 'Catch-up payment (earlier attempt failed)',
          amount: money(c.amountCents, c.currency),
          kind: 'default',
        })
      } else {
        timeline.push({
          date: shortDate(c.created, now),
          label: 'Payment',
          amount: money(c.amountCents, c.currency),
          kind: 'default',
        })
      }
    }
    for (const r of stripe.refunds)
      timeline.push({
        date: shortDate(r.created, now),
        label: 'Refund',
        amount: `-${money(r.amountCents, r.currency)}`,
        kind: 'muted',
      })
    for (const d of stripe.disputes)
      timeline.push({
        date: shortDate(d.created, now),
        label: `Dispute opened${d.reason ? ` · ${d.reason}` : ''}`,
        amount: money(d.amountCents, d.currency),
        kind: 'bad',
      })
  }
  // Newest first, like the design; keep the panel short.
  const withIso = timeline.map((t, i) => ({ t, i }))
  const sortKeys = new Map<CustomerContextTimelineEntry, string>()
  if (stripe) {
    const all = [
      ...stripe.subscriptions.flatMap((s) => [s.created, s.endedAt ?? s.canceledAt ?? '']),
      ...stripe.charges.map((c) => c.created),
      ...stripe.refunds.map((r) => r.created),
      ...stripe.disputes.map((d) => d.created),
    ].filter(Boolean)
    withIso.forEach(({ t, i }) => sortKeys.set(t, all[i] ?? ''))
  }
  const timelineSorted = [...timeline]
    .sort((a, b) => (sortKeys.get(b) ?? '').localeCompare(sortKeys.get(a) ?? ''))
    .slice(0, 12)

  const logErrorsNote =
    research.vercel.status === 'ok'
      ? facts.logErrors && facts.logErrors.length > 0
        ? null
        : 'None'
      : research.vercel.status === 'skipped'
        ? 'Not available · Vercel logs not configured'
        : `Unavailable · ${research.vercel.warning ?? 'Vercel logs failed'}`

  return {
    title: opts.customerName ? `Customer · ${opts.customerName}` : 'Customer',
    plan,
    timeline: timelineSorted,
    trackedProfiles: facts.trackedProfiles.map((p) => ({
      handle: `@${p.handle}`,
      meta: `since ${shortDate(p.since, now)}`,
    })),
    previousTickets: opts.previousTickets ?? [],
    logErrors: facts.logErrors && facts.logErrors.length > 0 ? facts.logErrors : null,
    logErrorsNote,
    tags: facts.tags,
  }
}
