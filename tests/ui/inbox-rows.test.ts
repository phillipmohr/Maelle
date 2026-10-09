import { describe, expect, it } from 'vitest'
import { buildSeed } from '../../shared/seed/data'
import { seedTicketList } from '../../shared/seed/views'
import {
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
