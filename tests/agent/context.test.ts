import { describe, expect, it } from 'vitest'
import {
  buildCustomerContext,
  deriveFacts,
  groupLogErrors,
  shortDate,
} from '../../server/agent/context'
import { gatherResearch } from '../../server/agent/research'
import { createFakeTools } from '../../server/agent/tools'
import { ticketRow, messageRow } from '../../evals/harness'
import {
  CASE_2_REFUND,
  CASE_3_CHARGEBACK,
  CASE_4_BUG,
  CASE_6_SAFETY,
} from '../../evals/fixtures/cases'
import { NOW, scanWorkerLogs } from '../../evals/fixtures/worlds'
import type { Fixture } from '../../evals/fixtures/types'
import type { FakeToolsOptions } from '../../server/agent/tools'

async function research(fixture: Fixture, opts: FakeToolsOptions = {}) {
  const ticket = ticketRow(fixture)
  const messages = fixture.messages.map((m, i) => messageRow(ticket.id, ticket, m, i))
  const progress: Record<string, string>[] = []
  const r = await gatherResearch({
    ticket,
    messages,
    tools: createFakeTools(fixture.tools, opts),
    emailHistory: async () => [],
    timeoutMs: 5000,
    now: NOW,
    onProgress: (p) => {
      progress.push({ ...p })
    },
  })
  return { ticket, ...r, progressHistory: progress }
}

describe('customer facts and context snapshot', () => {
  it('builds the chargeback customer from the mentioned email: long-term, resubscribed, disputes', async () => {
    const r = await research(CASE_3_CHARGEBACK)
    const facts = deriveFacts(r.ticket, r.bundle, NOW)
    expect(facts.stripeCustomerId).toBe('cus_RKim4417')
    expect(facts.instaradarUserId).toBe('usr_rkim_2f9a')
    expect(facts.tags).toEqual(
      expect.arrayContaining(['Long-term', 'Resubscribed', 'Dispute open', 'Cancelled']),
    )
    expect(facts.openDisputes).toHaveLength(3)
    expect(facts.latestChargeDisputed).toBe(true)
    expect(facts.signIns).toBe(41)
    const ctx = buildCustomerContext(facts, r.bundle, NOW, { customerName: facts.customerName })
    expect(ctx.title).toBe('Customer · Rachel Kim')
    expect(ctx.plan.find((p) => p.label === 'Status')?.value).toMatch(/Cancelled Aug 2/)
    expect(ctx.plan.find((p) => p.label === 'Card')?.value).toBe('Visa ··4417')
    expect(ctx.timeline.filter((t) => t.kind === 'bad').length).toBeGreaterThanOrEqual(3)
    expect(ctx.timeline[0]!.date).toBe('Aug 29')
    expect(ctx.trackedProfiles.map((p) => p.handle)).toEqual(['@kimbakes.co', '@lunchbox.rk'])
  })

  it('marks a new customer with the latest payment inside the window', async () => {
    const r = await research(CASE_2_REFUND)
    const facts = deriveFacts(r.ticket, r.bundle, NOW)
    expect(facts.tags).toContain('New customer')
    expect(facts.latestPayment?.paymentIntentId).toBe('pi_3QfA7x')
    expect(facts.daysSinceLatestPayment).toBe(12)
    expect(facts.refundCount).toBe(0)
    expect(facts.trackedProfiles).toHaveLength(4)
    const ctx = buildCustomerContext(facts, r.bundle, NOW)
    expect(ctx.plan.find((p) => p.label === 'Renews')?.value).toBe('October 15, 2026')
    expect(ctx.logErrorsNote).toBe('None')
  })

  it('groups log errors with counts and tags business / yearly plans', async () => {
    const r = await research(CASE_4_BUG)
    const facts = deriveFacts(r.ticket, r.bundle, NOW)
    expect(facts.tags).toEqual(expect.arrayContaining(['Long-term', 'Business plan', 'Yearly']))
    expect(facts.logErrors?.[0]).toMatchObject({ count: 14 })
    expect(facts.logErrors?.[0]?.text).toMatch(/media 404/)
    const grouped = groupLogErrors(scanWorkerLogs('u', 'h', '1'))
    expect(grouped.map((g) => g.count)).toEqual([14, 3])
  })

  it('degrades gracefully when a source fails or the person is not a customer', async () => {
    const r = await research(CASE_6_SAFETY, { vercel: { fail: 'Vercel timeout' } })
    expect(r.progress.vercel).toBe('failed')
    expect(r.warnings.join(' ')).toMatch(/Vercel logs unavailable \(Vercel timeout\)/)
    const facts = deriveFacts(r.ticket, r.bundle, NOW)
    expect(facts.stripeCustomerId).toBeNull()
    expect(facts.plan).toBeNull()
    expect(r.bundle.supabase.data?.mentionedProfiles[0]).toMatchObject({
      handle: 'sara.lindqvist',
      trackedByUsers: 3,
    })
    const ctx = buildCustomerContext(facts, r.bundle, NOW)
    expect(ctx.plan.find((p) => p.label === 'Plan')?.value).toBe('No subscription')
    expect(ctx.logErrorsNote).toMatch(/Unavailable · Vercel logs unavailable/)
    // Progress moved source by source and ended without pending entries.
    expect(r.progressHistory.length).toBeGreaterThan(3)
    const external = ['stripe', 'supabase', 'vercel', 'linear', 'email'] as const
    expect(external.map((k) => r.progress[k])).not.toContain('pending')
  })

  it('marks unconfigured sources as skipped', async () => {
    const r = await research(CASE_2_REFUND, {
      linear: { unconfigured: true },
      vercel: { unconfigured: true },
    })
    expect(r.progress.linear).toBe('skipped')
    expect(r.progress.vercel).toBe('skipped')
    expect(r.warnings).toEqual(
      expect.arrayContaining(['Linear not configured', 'Vercel logs not configured']),
    )
  })

  it('formats short dates like the design', () => {
    expect(shortDate('2026-09-15T00:00:00Z', NOW)).toBe('Sep 15')
    expect(shortDate('2024-11-02T00:00:00Z', NOW)).toBe('Nov 2, 2024')
  })
})
