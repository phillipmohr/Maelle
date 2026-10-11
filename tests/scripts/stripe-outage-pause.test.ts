/** IRDR-479: the outage pause run against an in-memory Stripe that enforces the pause rules. */
import { describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import {
  createStripeOutageClient,
  PAUSE_API_VERSION,
  PAUSE_PARAMS,
  runOutagePause,
  type OutageInvoice,
  type OutageLogEvent,
  type OutageStripeClient,
  type OutageSubscription,
} from '../../scripts/lib/stripe-outage-pause'

const PAUSED_AT = 1_791_400_000

function sub(id: string, overrides: Partial<OutageSubscription> = {}): OutageSubscription {
  return {
    id,
    customer: `cus_${id}`,
    status: 'active',
    billingMode: 'classic',
    collectionMethod: 'charge_automatically',
    schedule: null,
    billingSchedules: 0,
    pauseCollection: false,
    paused: null,
    ...overrides,
  }
}

function invoice(id: string, overrides: Partial<OutageInvoice> = {}): OutageInvoice {
  return {
    id,
    customer: null,
    subscription: null,
    status: 'open',
    autoAdvance: true,
    amountRemaining: 1900,
    currency: 'eur',
    ...overrides,
  }
}

/** Mirrors Stripe: pause needs flexible + active/past_due + charge_automatically + no schedules. */
function fakeStripe(subs: OutageSubscription[], invoices: OutageInvoice[]) {
  const calls: { method: string; id: string; key: string }[] = []
  const failOn = new Set<string>()
  const failOnce = new Set<string>()
  const find = (id: string) => {
    const s = subs.find((x) => x.id === id)
    if (!s) throw new Error(`No such subscription: ${id}`)
    return s
  }
  const client: OutageStripeClient = {
    listSubscriptions: async () => subs.map((s) => ({ ...s })),
    listInvoices: async (status) =>
      invoices.filter((i) => i.status === status).map((i) => ({ ...i })),
    migrateToFlexible: async (id, key) => {
      calls.push({ method: 'migrate', id, key })
      if (failOn.has(`migrate:${id}`)) throw new Error('migrate refused')
      find(id).billingMode = 'flexible'
    },
    pause: async (id, key) => {
      calls.push({ method: 'pause', id, key })
      const s = find(id)
      if (failOn.has(`pause:${id}`) || failOnce.delete(`pause:${id}`))
        throw new Error('pause refused')
      if (s.billingMode !== 'flexible') throw new Error('requires flexible billing mode')
      if (!['active', 'past_due'].includes(s.status)) throw new Error(`cannot pause ${s.status}`)
      if (s.schedule || s.billingSchedules > 0 || s.collectionMethod !== 'charge_automatically')
        throw new Error('not pausable')
      s.status = 'paused'
      s.paused = { reason: 'pause_requested', transitionedAt: PAUSED_AT }
      return { ...s }
    },
    voidInvoice: async (id, key) => {
      calls.push({ method: 'void', id, key })
      const inv = invoices.find((i) => i.id === id)!
      if (failOn.has(`void:${id}`)) throw new Error('void refused')
      inv.status = 'void'
      // Voiding the outstanding invoice returns an unpaid/past_due subscription to active.
      const owner = subs.find((s) => s.id === inv.subscription)
      const stillOpen = invoices.some((i) => i.subscription === owner?.id && i.status === 'open')
      if (owner && ['unpaid', 'past_due'].includes(owner.status) && !stillOpen)
        owner.status = 'active'
    },
    disableAutoAdvance: async (id, key) => {
      calls.push({ method: 'no-auto-advance', id, key })
      invoices.find((i) => i.id === id)!.autoAdvance = false
    },
  }
  return { client, calls, failOn, failOnce, subs, invoices }
}

async function run(stripe: ReturnType<typeof fakeStripe>) {
  const events: OutageLogEvent[] = []
  const report = await runOutagePause(stripe.client, { runId: 'r1', log: (e) => events.push(e) })
  return { report, events }
}

describe('runOutagePause', () => {
  it('migrates classic subscriptions, then pauses active and past_due ones', async () => {
    const stripe = fakeStripe(
      [
        sub('classic'),
        sub('flex', { billingMode: 'flexible' }),
        sub('late', { status: 'past_due' }),
      ],
      [],
    )
    const { report } = await run(stripe)

    expect(stripe.calls.filter((c) => c.method === 'migrate').map((c) => c.id)).toEqual([
      'classic',
      'late',
    ])
    expect(stripe.subs.every((s) => s.status === 'paused')).toBe(true)
    expect(report.ok).toBe(true)
    expect(report.counts).toMatchObject({ migrated: 2, paused: 3, failures: 0 })
    expect(report.paused).toEqual(
      expect.arrayContaining([
        {
          id: 'flex',
          customer: 'cus_flex',
          reason: 'pause_requested',
          transitionedAt: PAUSED_AT,
          pausedThisRun: true,
        },
      ]),
    )
  })

  it('pauses before touching invoices, voids open ones and stops auto-advancing drafts', async () => {
    const stripe = fakeStripe(
      [sub('s1', { billingMode: 'flexible' })],
      [
        invoice('in_open', { subscription: 's1' }),
        invoice('in_oneoff'),
        invoice('in_draft', { status: 'draft' }),
        invoice('in_manual_draft', { status: 'draft', autoAdvance: false }),
        invoice('in_paid', { status: 'paid' }),
      ],
    )
    const { report } = await run(stripe)

    expect(stripe.calls.map((c) => `${c.method}:${c.id}`)).toEqual([
      'pause:s1',
      'void:in_open',
      'void:in_oneoff',
      'no-auto-advance:in_draft',
    ])
    expect(stripe.invoices.find((i) => i.id === 'in_paid')!.status).toBe('paid')
    expect(report.counts).toMatchObject({ voided: 2, autoAdvanceDisabled: 1 })
    expect(report.ok).toBe(true)
  })

  it('pauses an unpaid subscription in the second pass, once its open invoice is voided', async () => {
    const stripe = fakeStripe(
      [sub('owing', { status: 'unpaid' })],
      [invoice('in_owing', { subscription: 'owing' })],
    )
    const { report, events } = await run(stripe)

    expect(stripe.subs[0]!.status).toBe('paused')
    const pauses = events.filter((e) => e.kind === 'action' && e.action === 'pause')
    expect(pauses).toEqual([expect.objectContaining({ step: 'pause-2', id: 'owing', ok: true })])
    expect(report.ok).toBe(true)
  })

  it('leaves blocked subscriptions alone and reports them with the reason', async () => {
    const stripe = fakeStripe(
      [
        sub('scheduled', { schedule: 'sub_sched_1' }),
        sub('invoiced', { collectionMethod: 'send_invoice' }),
        sub('billing_sched', { billingSchedules: 1 }),
        sub('trial', { status: 'trialing' }),
        sub('incomplete', { status: 'incomplete' }),
      ],
      [],
    )
    const { report } = await run(stripe)

    expect(stripe.calls).toEqual([])
    expect(report.ok).toBe(false)
    expect(Object.fromEntries(report.notPaused.map((s) => [s.id, s.reason]))).toEqual({
      scheduled: 'subscription schedule sub_sched_1',
      invoiced: 'collection_method send_invoice',
      billing_sched: 'active billing_schedules',
      trial: 'status trialing',
      incomplete: 'status incomplete',
    })
  })

  it('ignores ended and already paused subscriptions, so a re-run changes nothing', async () => {
    const earlier = { reason: 'pause_requested', transitionedAt: 1_791_300_000 }
    const stripe = fakeStripe(
      [
        sub('gone', { status: 'canceled' }),
        sub('expired', { status: 'incomplete_expired' }),
        sub('done', { status: 'paused', billingMode: 'flexible', paused: earlier }),
      ],
      [invoice('in_void', { status: 'void' })],
    )
    const { report } = await run(stripe)

    expect(stripe.calls).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.paused).toEqual([
      { id: 'done', customer: 'cus_done', ...earlier, pausedThisRun: false },
    ])
  })

  it('records a failed write, carries on with the rest and reports not clean', async () => {
    const stripe = fakeStripe(
      [
        sub('bad'),
        sub('good', { billingMode: 'flexible' }),
        sub('stuck', { billingMode: 'flexible' }),
      ],
      [invoice('in_locked'), invoice('in_ok')],
    )
    stripe.failOn.add('migrate:bad')
    stripe.failOn.add('pause:stuck')
    stripe.failOn.add('void:in_locked')
    const { report } = await run(stripe)

    expect(stripe.subs.find((s) => s.id === 'good')!.status).toBe('paused')
    expect(stripe.calls.some((c) => c.method === 'pause' && c.id === 'bad')).toBe(false)
    expect(stripe.invoices.find((i) => i.id === 'in_ok')!.status).toBe('void')
    expect(report.ok).toBe(false)
    expect(report.failures.map((f) => `${f.action}:${f.id}`)).toEqual([
      'migrate:bad',
      'pause:stuck',
      'void:in_locked',
      // Retried in the second pass, still failing.
      'migrate:bad',
      'pause:stuck',
    ])
    expect(report.notPaused.map((s) => s.id)).toEqual(['bad', 'stuck'])
    expect(report.openInvoicesLeft.map((i) => i.id)).toEqual(['in_locked'])
  })

  it('gives every write a run-scoped idempotency key', async () => {
    const stripe = fakeStripe([sub('s1')], [invoice('in_1'), invoice('in_2', { status: 'draft' })])
    await run(stripe)
    expect(stripe.calls.map((c) => c.key)).toEqual([
      'outage-migrate-s1-r1-pause-1',
      'outage-pause-s1-r1-pause-1',
      'outage-void-in_1-r1-invoices',
      'outage-disable-auto-advance-in_2-r1-invoices',
    ])
  })

  it('is clean when a pause refused in the first pass goes through in the second', async () => {
    const stripe = fakeStripe(
      [sub('late', { status: 'past_due', billingMode: 'flexible' })],
      [invoice('in_late', { subscription: 'late' })],
    )
    stripe.failOnce.add('pause:late')
    const { report } = await run(stripe)

    expect(stripe.calls.filter((c) => c.method === 'pause').map((c) => c.key)).toEqual([
      'outage-pause-late-r1-pause-1',
      'outage-pause-late-r1-pause-2',
    ])
    expect(stripe.subs[0]!.status).toBe('paused')
    expect(report.failures).toHaveLength(1)
    expect(report.ok).toBe(true)
  })
})

describe('createStripeOutageClient', () => {
  const rawSub = {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'paused',
    billing_mode: { type: 'flexible' },
    collection_method: 'charge_automatically',
    schedule: null,
    billing_schedules: [],
    pause_collection: null,
    status_details: {
      paused: {
        subscription: { type: 'pause_requested' },
        transitioned_at: PAUSED_AT,
        type: 'subscription',
      },
    },
  }

  it('pauses through rawRequest at API version endive with no credit and no usage billing', async () => {
    const rawRequest = vi.fn().mockResolvedValue(rawSub)
    const client = createStripeOutageClient({ rawRequest } as unknown as Stripe)

    const paused = await client.pause('sub_1', 'key-1')

    expect(rawRequest).toHaveBeenCalledWith('POST', '/v1/subscriptions/sub_1/pause', PAUSE_PARAMS, {
      apiVersion: PAUSE_API_VERSION,
      idempotencyKey: 'key-1',
    })
    expect(PAUSE_PARAMS).toEqual({
      bill_for: {
        unused_time_from: { type: 'none' },
        outstanding_usage_through: { type: 'none' },
      },
    })
    expect(paused).toMatchObject({
      status: 'paused',
      billingMode: 'flexible',
      paused: { reason: 'pause_requested', transitionedAt: PAUSED_AT },
    })
  })

  it('pages through every subscription with status=all', async () => {
    const rawRequest = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ ...rawSub, id: 'sub_a' }], has_more: true })
      .mockResolvedValueOnce({
        data: [
          {
            ...rawSub,
            id: 'sub_b',
            status: 'active',
            status_details: null,
            schedule: { id: 'sched_1' },
          },
        ],
        has_more: false,
      })
    const client = createStripeOutageClient({ rawRequest } as unknown as Stripe)

    const subs = await client.listSubscriptions()

    expect(rawRequest.mock.calls.map((c) => c[1])).toEqual([
      '/v1/subscriptions?status=all&limit=100',
      '/v1/subscriptions?status=all&limit=100&starting_after=sub_a',
    ])
    expect(rawRequest.mock.calls[0]![3]).toEqual({ apiVersion: PAUSE_API_VERSION })
    expect(subs.map((s) => [s.id, s.schedule, s.paused])).toEqual([
      ['sub_a', null, { reason: 'pause_requested', transitionedAt: PAUSED_AT }],
      ['sub_b', 'sched_1', null],
    ])
  })
})
