import { describe, expect, it } from 'vitest'
import { buildSeed } from '../../shared/seed/data'
import { seedTicketList } from '../../shared/seed/views'
import {
  activeFilterCount,
  availableTags,
  closedFilterCount,
  closedQuery,
  defaultClosedFilters,
  defaultListFilters,
  matchesListFilters,
  rangeLabel,
} from '../../app/composables/useInboxFilters'

const now = new Date('2026-09-27T10:00:00')
const items = seedTicketList(buildSeed(now), now).items
const by = (n: number) => items.find((i) => i.displayNumber === n)!

describe('ticket list filters', () => {
  it('quick chips: Risk and Billing', () => {
    const risk = { ...defaultListFilters(), quick: 'risk' as const }
    expect(items.filter((i) => matchesListFilters(i, risk)).map((i) => i.displayNumber)).toEqual([
      4825,
    ])
    const billing = { ...defaultListFilters(), quick: 'billing' as const }
    const nums = items.filter((i) => matchesListFilters(i, billing)).map((i) => i.displayNumber)
    expect(nums).toContain(4825)
    expect(nums).toContain(4822)
    expect(nums).toContain(4801)
    expect(nums).not.toContain(4824)
  })

  it('detailed filters: status, case, risk, confirmation, tags, dates', () => {
    const f = defaultListFilters()
    expect(activeFilterCount(f)).toBe(0)
    f.statuses = ['action_failed']
    expect(items.filter((i) => matchesListFilters(i, f)).map((i) => i.displayNumber)).toEqual([
      4820,
    ])
    f.statuses = []
    f.needsConfirmation = true
    expect(items.filter((i) => matchesListFilters(i, f)).map((i) => i.displayNumber)).toEqual([
      4822,
    ])
    f.needsConfirmation = false
    f.tags = ['Long-term']
    expect(
      items
        .filter((i) => matchesListFilters(i, f))
        .map((i) => i.displayNumber)
        .sort(),
    ).toEqual([4820, 4825])
    f.tags = []
    f.caseTypes = ['cancellation_only']
    f.risk = ['none']
    expect(matchesListFilters(by(4824), f)).toBe(true)
    expect(matchesListFilters(by(4825), f)).toBe(false)
    f.caseTypes = []
    f.risk = []
    f.from = '2026-09-27'
    expect(matchesListFilters(by(4825), f)).toBe(true)
    expect(matchesListFilters(by(4819), f)).toBe(false)
    expect(activeFilterCount(f)).toBe(1)
    expect(availableTags(items)).toEqual([
      'Business plan',
      'Long-term',
      'New customer',
      'Refund pending',
      'Resubscribed',
    ])
  })
})

describe('closed table filters', () => {
  it('turns chips, case and range into query parameters', () => {
    const f = defaultClosedFilters()
    expect(closedQuery(f, now)).toEqual({})
    expect(closedFilterCount(f)).toBe(0)
    f.chip = 'approved_with_edits'
    f.caseType = 'refund_request'
    f.range = '7d'
    const q = closedQuery(f, now)
    expect(q.resolution).toBe('approved_with_edits')
    expect(q.caseType).toBe('refund_request')
    expect(q.from).toBe(new Date(now.getTime() - 7 * 24 * 3600_000).toISOString())
    expect(closedFilterCount(f)).toBe(2)
    expect(rangeLabel(f)).toBe('Last 7 days')
    f.range = 'custom'
    f.from = '2026-09-01'
    f.to = '2026-09-25'
    const c = closedQuery(f, now)
    expect(c.from).toBe(new Date('2026-09-01').toISOString())
    expect(c.to!.startsWith('2026-09-25') || c.to!.startsWith('2026-09-26')).toBe(true)
    expect(rangeLabel(f)).toBe('2026-09-01 to 2026-09-25')
  })
})
