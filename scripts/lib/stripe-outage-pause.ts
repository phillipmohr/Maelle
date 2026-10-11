/**
 * IRDR-479: stop all billing during the InstaRadar outage. Pauses every pausable subscription
 * (status `paused`, no invoice generation until a manual resume), voids every open invoice and
 * stops every auto-advancing draft from finalizing. Runs live, no dry run (decided by Phillip).
 *
 * The run talks to Stripe through the narrow `OutageStripeClient`, so the whole flow is tested
 * against an in-memory fake (tests/scripts/stripe-outage-pause.test.ts). The entrypoint is
 * scripts/stripe-outage-pause.ts.
 */
import type Stripe from 'stripe'

/** `POST /v1/subscriptions/:id/pause` exists from this API version on (stripe@23). */
export const PAUSE_API_VERSION = '2026-09-30.endive'

/**
 * No credit for unused time and no bill for metered usage: the outage refund is IRDR-480, every
 * other refund goes through Customer Service. The default (`now`) would leave pending credit items
 * that only settle on a resume invoice.
 */
export const PAUSE_PARAMS = {
  bill_for: {
    unused_time_from: { type: 'none' },
    outstanding_usage_through: { type: 'none' },
  },
} as const

export interface OutageSubscription {
  id: string
  customer: string
  status: string
  /** `classic` | `flexible`; pausing needs `flexible`. */
  billingMode: string
  collectionMethod: string
  schedule: string | null
  billingSchedules: number
  pauseCollection: boolean
  /** From `status_details.paused` (API version endive); null when not paused. */
  paused: { reason: string | null; transitionedAt: number | null } | null
}

export interface OutageInvoice {
  id: string
  customer: string | null
  subscription: string | null
  status: string
  autoAdvance: boolean
  amountRemaining: number
  currency: string
}

export interface OutageStripeClient {
  /** Every subscription (`status=all`), auto-paginated. */
  listSubscriptions(): Promise<OutageSubscription[]>
  /** Every invoice with this status, auto-paginated. */
  listInvoices(status: 'open' | 'draft'): Promise<OutageInvoice[]>
  migrateToFlexible(id: string, idempotencyKey: string): Promise<void>
  pause(id: string, idempotencyKey: string): Promise<OutageSubscription>
  voidInvoice(id: string, idempotencyKey: string): Promise<void>
  disableAutoAdvance(id: string, idempotencyKey: string): Promise<void>
}

export type OutageLogEvent =
  | { kind: 'inventory'; label: string; data: unknown }
  | {
      kind: 'action'
      step: 'pause-1' | 'invoices' | 'pause-2'
      action: 'migrate' | 'pause' | 'void' | 'disable-auto-advance' | 'skip'
      id: string
      ok: boolean
      detail?: string
      data?: unknown
    }

export interface PausedSubscription {
  id: string
  customer: string
  reason: string | null
  /** Unix seconds; IRDR-480 uses it as the end of each customer's outage window. */
  transitionedAt: number | null
  pausedThisRun: boolean
}

export interface OutageReport {
  runId: string
  ok: boolean
  counts: {
    subscriptionsByStatus: Record<string, number>
    migrated: number
    paused: number
    voided: number
    autoAdvanceDisabled: number
    failures: number
  }
  paused: PausedSubscription[]
  /** Not paused and still able to bill (blocked by schedule, send_invoice, ...). */
  notPaused: { id: string; customer: string; status: string; reason: string }[]
  openInvoicesLeft: OutageInvoice[]
  autoAdvancingDraftsLeft: OutageInvoice[]
  failures: { action: string; id: string; error: string }[]
}

type Plan =
  | { kind: 'pause' }
  | { kind: 'ignore'; reason: string }
  | { kind: 'blocked'; reason: string }
  | { kind: 'after-void'; reason: string }

const ENDED = new Set(['canceled', 'incomplete_expired'])
/** Statuses that can still produce invoices or charges. */
const BILLING = new Set(['active', 'past_due', 'unpaid', 'trialing', 'incomplete'])

/** What to do with a subscription. `unpaid` returns to `active` once its open invoice is voided. */
export function planFor(sub: OutageSubscription, pass: 1 | 2): Plan {
  if (ENDED.has(sub.status)) return { kind: 'ignore', reason: sub.status }
  if (sub.status === 'paused') return { kind: 'ignore', reason: 'already paused' }
  if (sub.schedule) return { kind: 'blocked', reason: `subscription schedule ${sub.schedule}` }
  if (sub.collectionMethod === 'send_invoice')
    return { kind: 'blocked', reason: 'collection_method send_invoice' }
  if (sub.billingSchedules > 0) return { kind: 'blocked', reason: 'active billing_schedules' }
  if (sub.status === 'unpaid')
    return pass === 1
      ? { kind: 'after-void', reason: 'unpaid: paused after its open invoice is voided' }
      : { kind: 'blocked', reason: 'still unpaid after voiding its open invoices' }
  if (sub.status === 'active' || sub.status === 'past_due') return { kind: 'pause' }
  return { kind: 'blocked', reason: `status ${sub.status}` }
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1
  return out
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function runOutagePause(
  client: OutageStripeClient,
  opts: { runId: string; log: (event: OutageLogEvent) => void },
): Promise<OutageReport> {
  const { runId, log } = opts
  const failures: OutageReport['failures'] = []
  const pausedNow = new Map<string, OutageSubscription>()
  const done = { migrate: 0, void: 0, 'disable-auto-advance': 0 }

  type Step = 'pause-1' | 'invoices' | 'pause-2'
  type Write = 'migrate' | 'pause' | 'void' | 'disable-auto-advance'
  /**
   * One write: logged, failures recorded, the run carries on. The idempotency key is scoped to the
   * run and step, so SDK retries within a step dedupe, while the second pause pass gets a fresh key
   * (Stripe replays a cached error for a reused key).
   */
  const attempt = async <T>(
    step: Step,
    action: Write,
    id: string,
    write: (idempotencyKey: string) => Promise<T>,
    context?: unknown,
  ): Promise<{ ok: true; value: T } | { ok: false }> => {
    try {
      const value = await write(`outage-${action}-${id}-${runId}-${step}`)
      log({ kind: 'action', step, action, id, ok: true, data: value ?? context })
      return { ok: true, value }
    } catch (e) {
      failures.push({ action, id, error: message(e) })
      log({ kind: 'action', step, action, id, ok: false, detail: message(e), data: context })
      return { ok: false }
    }
  }

  // 1. Inventory: logged in full, no review stop.
  const subs = await client.listSubscriptions()
  const open = await client.listInvoices('open')
  const drafts = await client.listInvoices('draft')
  log({
    kind: 'inventory',
    label: 'subscriptions',
    data: {
      byStatus: countBy(subs, (s) => s.status),
      byBillingMode: countBy(subs, (s) => s.billingMode),
      byCollectionMethod: countBy(subs, (s) => s.collectionMethod),
      withSchedule: subs.filter((s) => s.schedule).length,
      withBillingSchedules: subs.filter((s) => s.billingSchedules > 0).length,
      withPauseCollection: subs.filter((s) => s.pauseCollection).length,
      subscriptions: subs,
    },
  })
  log({ kind: 'inventory', label: 'open invoices', data: open })
  log({
    kind: 'inventory',
    label: 'auto-advancing draft invoices',
    data: drafts.filter((i) => i.autoAdvance),
  })

  const pausePass = async (step: 'pause-1' | 'pause-2', list: OutageSubscription[]) => {
    for (const sub of list) {
      const plan = planFor(sub, step === 'pause-1' ? 1 : 2)
      if (plan.kind !== 'pause') {
        // Ended and already-paused subscriptions are covered by the inventory.
        if (plan.kind !== 'ignore')
          log({ kind: 'action', step, action: 'skip', id: sub.id, ok: true, detail: plan.reason })
        continue
      }
      if (sub.billingMode !== 'flexible') {
        const migrated = await attempt(step, 'migrate', sub.id, (k) =>
          client.migrateToFlexible(sub.id, k),
        )
        if (!migrated.ok) continue
        done.migrate++
      }
      const paused = await attempt(step, 'pause', sub.id, (k) => client.pause(sub.id, k))
      if (paused.ok) pausedNow.set(sub.id, paused.value)
    }
  }

  // 2. Pause first, so no new renewal invoice appears while the invoices are cleaned up.
  await pausePass('pause-1', subs)

  // 3. Invoices, listed again to catch anything created since the inventory. Voiding is final.
  for (const inv of await client.listInvoices('open')) {
    const voided = await attempt(
      'invoices',
      'void',
      inv.id,
      (k) => client.voidInvoice(inv.id, k),
      inv,
    )
    if (voided.ok) done.void++
  }
  for (const inv of (await client.listInvoices('draft')).filter((i) => i.autoAdvance)) {
    const held = await attempt(
      'invoices',
      'disable-auto-advance',
      inv.id,
      (k) => client.disableAutoAdvance(inv.id, k),
      inv,
    )
    if (held.ok) done['disable-auto-advance']++
  }

  // 4. Second pass: formerly `unpaid` subscriptions are `active` again after voiding.
  await pausePass('pause-2', await client.listSubscriptions())

  // 5. Verify against a fresh read.
  const finalSubs = await client.listSubscriptions()
  const openLeft = await client.listInvoices('open')
  const draftsLeft = (await client.listInvoices('draft')).filter((i) => i.autoAdvance)
  const paused: PausedSubscription[] = finalSubs
    .filter((s) => s.status === 'paused')
    .map((s) => {
      const info = s.paused ?? pausedNow.get(s.id)?.paused ?? null
      return {
        id: s.id,
        customer: s.customer,
        reason: info?.reason ?? null,
        transitionedAt: info?.transitionedAt ?? null,
        pausedThisRun: pausedNow.has(s.id),
      }
    })
  const notPaused = finalSubs
    .filter((s) => BILLING.has(s.status))
    .map((s) => {
      const plan = planFor(s, 2)
      return {
        id: s.id,
        customer: s.customer,
        status: s.status,
        reason: plan.kind === 'pause' ? 'pausable but not paused (see failures)' : plan.reason,
      }
    })
  const pausedWrongReason = paused.filter((p) => p.pausedThisRun && p.reason !== 'pause_requested')

  return {
    runId,
    // Judged on the final state: a write that failed once but was fixed later (e.g. a pause that
    // only succeeds in the second pass) doesn't make the run unclean; it stays in `failures`.
    ok:
      notPaused.length === 0 &&
      openLeft.length === 0 &&
      draftsLeft.length === 0 &&
      pausedWrongReason.length === 0,
    counts: {
      subscriptionsByStatus: countBy(finalSubs, (s) => s.status),
      migrated: done.migrate,
      paused: pausedNow.size,
      voided: done.void,
      autoAdvanceDisabled: done['disable-auto-advance'],
      failures: failures.length,
    },
    paused,
    notPaused,
    openInvoicesLeft: openLeft,
    autoAdvancingDraftsLeft: draftsLeft,
    failures,
  }
}

/** The raw subscription JSON at API version endive (only the fields this script reads). */
interface RawSubscription {
  id: string
  customer: string | { id: string }
  status: string
  billing_mode?: { type?: string } | null
  collection_method?: string | null
  schedule?: string | { id: string } | null
  billing_schedules?: unknown[] | null
  pause_collection?: unknown | null
  status_details?: {
    paused?: { transitioned_at?: number | null; subscription?: { type?: string } | null } | null
  } | null
}

const idOf = (v: string | { id: string } | null | undefined): string | null =>
  v == null ? null : typeof v === 'string' ? v : v.id

export function toOutageSubscription(raw: RawSubscription): OutageSubscription {
  const paused = raw.status_details?.paused
  return {
    id: raw.id,
    customer: idOf(raw.customer) ?? '',
    status: raw.status,
    billingMode: raw.billing_mode?.type ?? 'classic',
    collectionMethod: raw.collection_method ?? 'charge_automatically',
    schedule: idOf(raw.schedule),
    billingSchedules: raw.billing_schedules?.length ?? 0,
    pauseCollection: raw.pause_collection != null,
    paused: paused
      ? {
          reason: paused.subscription?.type ?? null,
          transitionedAt: paused.transitioned_at ?? null,
        }
      : null,
  }
}

export function toOutageInvoice(inv: Stripe.Invoice): OutageInvoice {
  const sub = inv.parent?.subscription_details?.subscription
  return {
    id: inv.id ?? '',
    customer: idOf(inv.customer),
    subscription: idOf(sub),
    status: inv.status ?? '',
    autoAdvance: inv.auto_advance === true,
    amountRemaining: inv.amount_remaining,
    currency: inv.currency,
  }
}

/**
 * The real client. Subscriptions are read and paused through `rawRequest` at API version endive
 * (pause and `status_details` don't exist in the pinned stripe@22 / dahlia); everything else uses
 * the typed SDK.
 */
export function createStripeOutageClient(stripe: Stripe): OutageStripeClient {
  const endive = { apiVersion: PAUSE_API_VERSION }
  return {
    async listSubscriptions() {
      const out: OutageSubscription[] = []
      let after: string | null = null
      for (;;) {
        const query = `status=all&limit=100${after ? `&starting_after=${after}` : ''}`
        const page = (await stripe.rawRequest(
          'GET',
          `/v1/subscriptions?${query}`,
          undefined,
          endive,
        )) as {
          data: RawSubscription[]
          has_more: boolean
        }
        out.push(...page.data.map(toOutageSubscription))
        if (!page.has_more || page.data.length === 0) return out
        after = page.data[page.data.length - 1]!.id
      }
    },
    async listInvoices(status) {
      const out: OutageInvoice[] = []
      for await (const inv of stripe.invoices.list({ status, limit: 100 }))
        out.push(toOutageInvoice(inv))
      return out
    },
    async migrateToFlexible(id, idempotencyKey) {
      await stripe.subscriptions.migrate(
        id,
        { billing_mode: { type: 'flexible' } },
        { idempotencyKey },
      )
    },
    async pause(id, idempotencyKey) {
      const raw = (await stripe.rawRequest('POST', `/v1/subscriptions/${id}/pause`, PAUSE_PARAMS, {
        ...endive,
        idempotencyKey,
      })) as RawSubscription
      return toOutageSubscription(raw)
    },
    async voidInvoice(id, idempotencyKey) {
      await stripe.invoices.voidInvoice(id, {}, { idempotencyKey })
    },
    async disableAutoAdvance(id, idempotencyKey) {
      await stripe.invoices.update(id, { auto_advance: false }, { idempotencyKey })
    },
  }
}
