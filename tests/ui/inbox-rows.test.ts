import { describe, expect, it } from 'vitest'
import { buildSeed } from '../../shared/seed/data'
import { seedTicketList } from '../../shared/seed/views'
import type { ApproveAllResponse, ApproveAllTicket } from '../../shared/api'
import { caseLabel } from '../../shared/case-types'
import {
  approvableDrafts,
  approveAllBreakdown,
  approveAllRefundLine,
  approveAllSkippedRows,
  approveAllToast,
  caseText,
  dayGroups,
  decisionPill,
  inboxSummary,
  listSubline,
  listTag,
  listTime,
  needsDecisionRows,
  nextTicketNumber,
  parkedGroups,
  proposalText,
  regenerableDrafts,
  researchChecklist,
  returnLabel,
  rowDot,
  rowPill,
  rowTint,
} from '../../app/composables/useInboxRows'

const now = new Date('2026-09-27T10:00:00')
const list = seedTicketList(buildSeed(now), now)
const items = list.items
const by = (n: number) => items.find((i) => i.displayNumber === n)!

describe('approve & send all (IRDR-481)', () => {
  it('counts the safe unsent drafts in the menu: no high risk, no safety', () => {
    const drafts = regenerableDrafts(items)
    const high = { ...by(4824), riskLevel: 'high' as const }
    const safety = { ...by(4824), riskLevel: 'safety' as const }
    expect(approvableDrafts([by(4824), high, safety])).toEqual([by(4824)])
    expect(approvableDrafts(items).every((d) => drafts.includes(d) && d.riskLevel === 'none')).toBe(
      true,
    )
  })

  it('breaks the replies down per case type, the largest first', () => {
    const t = (caseType: ApproveAllTicket['caseType'], n: number): ApproveAllTicket => ({
      ticketId: String(n),
      displayNumber: n,
      customerName: null,
      customerEmail: 'a@b.c',
      caseType,
      proposalVersion: 1,
    })
    const rows = approveAllBreakdown([
      t('feature_request', 1),
      t('cancellation_only', 2),
      t('cancellation_only', 3),
    ])
    expect(rows).toEqual([
      { label: caseLabel('cancellation_only'), value: '2' },
      { label: caseLabel('feature_request'), value: '1' },
    ])
  })

  it('sums the refunds per currency for the dialog line (IRDR-482)', () => {
    const t = (n: number, refund: ApproveAllTicket['refund']): ApproveAllTicket => ({
      ticketId: String(n),
      displayNumber: n,
      customerName: null,
      customerEmail: 'a@b.c',
      caseType: 'refund_request',
      proposalVersion: 1,
      refund,
    })
    expect(approveAllRefundLine([t(1, null)])).toBeNull()
    expect(
      approveAllRefundLine([
        t(1, { amountCents: 512, currency: 'usd' }),
        t(2, { amountCents: 999, currency: 'usd' }),
        t(3, null),
      ]),
    ).toBe('Includes 2 refunds · total 15.11 USD')
    expect(
      approveAllRefundLine([
        t(1, { amountCents: 512, currency: 'usd' }),
        t(2, { amountCents: 800, currency: 'eur' }),
      ]),
    ).toBe('Includes 2 refunds · total 5.12 USD + 8.00 EUR')
  })

  it('lists the skipped tickets by number with the reason', () => {
    expect(
      approveAllSkippedRows([
        { ticketId: 'b', displayNumber: 4830, reason: 'high_risk', detail: 'High risk' },
        { ticketId: 'a', displayNumber: 4821, reason: 'handoff', detail: 'Handed to you' },
      ]),
    ).toEqual([
      { label: '#4821', value: 'Handed to you' },
      { label: '#4830', value: 'High risk' },
    ])
  })

  it('turns the result into one toast; any failure makes it an error', () => {
    const res: ApproveAllResponse = {
      sent: [{ ticketId: 'a', displayNumber: 1, ticketStatus: 'closed' }],
      skipped: [],
      failed: [],
    }
    expect(approveAllToast(res)).toEqual({
      tone: 'info',
      title: 'Sent 1 reply',
      description: 'Every reply went out as proposed.',
    })
    expect(
      approveAllToast({
        sent: [],
        skipped: [{ ticketId: 'b', displayNumber: 2, reason: 'stale_version', detail: 'x' }],
        failed: [{ ticketId: 'c', displayNumber: 3, error: 'boom' }],
      }),
    ).toEqual({ tone: 'error', title: 'Nothing was sent', description: '1 skipped · 1 failed: #3' })
  })
})

describe('inbox rows', () => {
  it('counts the unsent drafts the 3-dot menu regenerates: needs decision with a proposal', () => {
    const drafts = regenerableDrafts(items)
    expect(drafts.length).toBeGreaterThan(0)
    expect(drafts.every((d) => d.status === 'needs_decision' && d.proposalLine !== null)).toBe(true)
    const researching = { ...by(4824), status: 'researching' as const }
    const snoozed = { ...by(4824), status: 'snoozed' as const }
    const noProposal = { ...by(4824), proposalLine: null }
    expect(regenerableDrafts([researching, snoozed, noProposal])).toEqual([])
    expect(regenerableDrafts([by(4824)])).toEqual([by(4824)])
  })

  it('shows imported history tickets as Imported with no decision', () => {
    expect(
      decisionPill({ resolution: null, decision: null, importedAt: '2026-09-29T00:00:00Z' }),
    ).toEqual({ kind: 'plain', status: 'neutral', label: 'Imported', dot: false })
    expect(
      decisionPill({ resolution: 'approved', decision: null, importedAt: '2026-09-29T00:00:00Z' })
        .label,
    ).toBe('Approved')
    const imported = { ...by(4801), caseType: null, importedAt: '2026-09-29T00:00:00Z' }
    expect(caseText(imported)).toBe('Not classified yet')
  })

  it('sorts needs decision: safety, high risk, then oldest first', () => {
    const rows = needsDecisionRows(items)
    expect(rows.map((r) => r.displayNumber)).toEqual([4825, 4809, 4819, 4822, 4824, 4820, 4828])
    const safety = { ...by(4824), riskLevel: 'safety' as const }
    expect(needsDecisionRows([...items, safety])[0]).toBe(safety)
  })

  it('summarises the inbox', () => {
    expect(inboxSummary(list.counts, items)).toBe(
      '6 need your decision · 10 closed in the last 3 days',
    )
    const closedOnly = items.filter((i) => i.status === 'closed')
    expect(inboxSummary(list.counts, closedOnly)).toBe('Nothing open · 2 closed today')
    const one = items.filter((i) => i.displayNumber === 4824)
    expect(inboxSummary(list.counts, one)).toMatch(/^1 needs your decision/)
  })

  it('derives pills, dots and tints from status and risk', () => {
    expect(rowPill(by(4825))).toEqual({ status: 'warning', label: 'High risk' })
    expect(rowPill(by(4822))).toEqual({ status: 'info', label: 'Needs confirmation' })
    expect(rowPill(by(4809))).toEqual({ status: 'success', label: 'Customer confirmed' })
    expect(rowPill(by(4820))).toEqual({ status: 'error', label: 'Action failed' })
    expect(rowPill(by(4828))).toEqual({ status: 'info', label: 'Researching' })
    expect(rowPill(by(4824))).toEqual({ status: 'draft', label: 'Needs decision' })
    // A hand-off (no instruction fits) waits for you, not for a decision on a draft.
    const handoff = { ...by(4824), handoffReason: 'Asks about story viewers.' }
    expect(rowPill(handoff)).toEqual({ status: 'draft', label: 'Needs you' })
    expect(regenerableDrafts([handoff])).toEqual([])
    expect(rowDot(by(4825))).toBe('high')
    expect(rowDot(by(4820))).toBe('failed')
    expect(rowDot(by(4828))).toBe('research')
    expect(rowDot(by(4801))).toBe('snoozed')
    expect(rowTint(by(4825))).toBe('ember')
    expect(rowTint(by(4824))).toBe('none')
    expect(rowTint({ ...by(4824), riskLevel: 'safety' })).toBe('brick')
  })

  it('renders the researching row with the live checklist', () => {
    const amelie = by(4828)
    expect(caseText(amelie)).toBe('Classifying…')
    expect(proposalText(amelie)).toBe('Researching · Vercel logs and Linear still loading')
    expect(researchChecklist(amelie.runProgress)).toBe(
      'Stripe ✓  Supabase ✓  Vercel ⋯  Notion ✓  Linear ⋯',
    )
    expect(researchChecklist(null)).toBe('')
    expect(caseText(by(4825))).toBe('Chargeback / bank dispute')
  })

  it('builds list sublines, tags and times', () => {
    expect(listSubline(by(4824), now)).toBe('Cancellation only · Unsubscribe · 3 actions')
    expect(listSubline(by(4822), now)).toBe(
      'Refund request · Needs customer confirmation · 3 actions',
    )
    expect(listSubline(by(4809), now)).toBe(
      'Refund request · Customer confirmed · stage 2 · 3 actions',
    )
    expect(listSubline(by(4820), now)).toBe('Bug report · Action failed · 3 actions')
    expect(listSubline(by(4828), now)).toBe('Researching')
    expect(listSubline(by(4801), now)).toBe('Billing question · Returns tomorrow at 09:00')
    expect(listTag(by(4820))).toEqual({ text: 'Retry or mark done', tone: 'brick' })
    expect(listTag(by(4809))).toEqual({ text: 'Returned from waiting', tone: 'slate-blue' })
    expect(listTag(by(4824))).toBeNull()
    expect(listTime(by(4801), now)).toBe('Tmrw')
    expect(listTime(by(4825), now)).toBe('3h')
    expect(listTime(by(4809), now)).toBe('3d')
  })

  it('collapses parked tickets into one line per group', () => {
    const groups = parkedGroups(items, now)
    expect(groups.map((g) => g.key)).toEqual(['snoozed'])
    expect(groups[0]!.text).toBe('Kate Morgan · Billing question · returns tomorrow at 09:00')
    const waiting = {
      ...by(4822),
      status: 'waiting_on_customer' as const,
      waitingFor: 'Yes, refund',
    }
    const g2 = parkedGroups([...items, waiting], now)
    expect(g2[0]!.key).toBe('waiting')
    expect(g2[0]!.text).toMatch(
      /^Marco Bianchi · Refund request · waiting for “Yes, refund” since /,
    )
    expect(returnLabel(new Date(now.getTime() + 3600_000).toISOString(), now)).toMatch(/^today at /)
  })

  it('groups closed tickets by day and maps the decision pill', () => {
    const closed = items
      .filter((i) => i.status === 'closed')
      .sort((a, b) => b.closedAt!.localeCompare(a.closedAt!))
    const groups = dayGroups(closed, now)
    expect(groups.map((g) => g.day)).toEqual(['Today', 'Yesterday', 'Sep 25'])
    expect(groups[0]!.rows.map((r) => r.displayNumber)).toEqual([4818, 4817])
    expect(decisionPill(by(4818))).toMatchObject({
      kind: 'pill',
      status: 'draft',
      label: 'Auto',
      dot: false,
    })
    expect(decisionPill(by(4815))).toMatchObject({ status: 'info', label: 'Approved with edits' })
    expect(decisionPill(by(4814))).toMatchObject({ status: 'error', label: 'Rejected' })
    expect(decisionPill(by(4806))).toMatchObject({ kind: 'plain', label: 'Handled manually' })
    expect(decisionPill(by(4805))).toMatchObject({ status: 'success', label: 'Approved' })
  })

  it('finds the next ticket to move to after a decision', () => {
    expect(nextTicketNumber(items, 4825)).toBe(4809)
    expect(nextTicketNumber(items, 4820)).toBe(4824)
    expect(nextTicketNumber(items, 4801)).toBe(4825)
    expect(
      nextTicketNumber(
        items.filter((i) => i.displayNumber === 4824),
        4824,
      ),
    ).toBeNull()
  })
})
