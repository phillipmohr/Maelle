/**
 * Filters for the ticket list (All / Risk / Billing chips and the F popover) and for the closed
 * table (All / Approved / Edited / Rejected / Manual / Auto, case, date range). Pure predicates and
 * query builders, plus small state composables.
 */
import type { TicketListItem } from '#shared/api'
import { CASE_TYPES, type CaseType, type RiskLevel } from '#shared/case-types'
import type { TicketResolution, TicketStatus } from '#shared/status'
import type { ClosedFilters } from '~/composables/useTickets'

export type QuickFilter = 'all' | 'risk' | 'billing'

export const BILLING_CASES: readonly CaseType[] = [
  'billing_question',
  'chargeback',
  'charged_after_cancellation',
  'refund_request',
  'second_refund_request',
  'cancellation_refund_deletion',
]

export interface ListFilters {
  quick: QuickFilter
  statuses: TicketStatus[]
  caseTypes: CaseType[]
  risk: RiskLevel[]
  needsConfirmation: boolean
  tags: string[]
  /** ISO date (inclusive) on the customer's last message. */
  from: string | null
  to: string | null
}

export function defaultListFilters(): ListFilters {
  return {
    quick: 'all',
    statuses: [],
    caseTypes: [],
    risk: [],
    needsConfirmation: false,
    tags: [],
    from: null,
    to: null,
  }
}

/** Number of active detailed filters (shown on the F chip). */
export function activeFilterCount(f: ListFilters): number {
  return (
    f.statuses.length +
    f.caseTypes.length +
    f.risk.length +
    (f.needsConfirmation ? 1 : 0) +
    f.tags.length +
    (f.from ? 1 : 0) +
    (f.to ? 1 : 0)
  )
}

export function matchesListFilters(i: TicketListItem, f: ListFilters): boolean {
  if (f.quick === 'risk' && i.riskLevel === 'none') return false
  if (f.quick === 'billing' && (!i.caseType || !BILLING_CASES.includes(i.caseType))) return false
  if (f.statuses.length > 0 && !f.statuses.includes(i.status)) return false
  if (f.caseTypes.length > 0 && (!i.caseType || !f.caseTypes.includes(i.caseType))) return false
  if (f.risk.length > 0 && !f.risk.includes(i.riskLevel)) return false
  if (
    f.needsConfirmation &&
    !(i.stage === 1 && i.caseType && CASE_TYPES[i.caseType].requiresConfirmation)
  )
    return false
  if (f.tags.length > 0 && !f.tags.some((t) => i.tags.includes(t))) return false
  const at = i.lastCustomerMessageAt ?? i.createdAt
  if (f.from && at < f.from) return false
  if (f.to && at > endOfDay(f.to)) return false
  return true
}

function endOfDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

/** Distinct customer tags across the list, for the filter popover. */
export function availableTags(items: readonly TicketListItem[]): string[] {
  return [...new Set(items.flatMap((i) => i.tags))].sort()
}

// ---------------------------------------------------------------- closed table

export type ClosedChip =
  'all' | 'approved' | 'approved_with_edits' | 'rejected' | 'handled_manually' | 'auto'

export const CLOSED_CHIPS: { value: ClosedChip; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'approved', label: 'Approved' },
  { value: 'approved_with_edits', label: 'Edited' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'handled_manually', label: 'Manual' },
  { value: 'auto', label: 'Auto' },
]

export type ClosedRange = 'all' | '7d' | '30d' | '90d' | 'custom'

export interface ClosedTableFilters {
  chip: ClosedChip
  caseType: CaseType | null
  range: ClosedRange
  from: string | null
  to: string | null
}

export function defaultClosedFilters(): ClosedTableFilters {
  return { chip: 'all', caseType: null, range: 'all', from: null, to: null }
}

export function closedFilterCount(f: ClosedTableFilters): number {
  return (f.caseType ? 1 : 0) + (f.range !== 'all' ? 1 : 0)
}

/** Query parameters for GET /api/tickets?status=closed from the table filters. */
export function closedQuery(f: ClosedTableFilters, now: Date): ClosedFilters {
  const out: ClosedFilters = {}
  if (f.chip !== 'all') out.resolution = f.chip as TicketResolution
  if (f.caseType) out.caseType = f.caseType
  if (f.range === 'custom') {
    if (f.from) out.from = new Date(f.from).toISOString()
    if (f.to) out.to = endOfDay(f.to)
  } else if (f.range !== 'all') {
    const days = f.range === '7d' ? 7 : f.range === '30d' ? 30 : 90
    out.from = new Date(now.getTime() - days * 24 * 3_600_000).toISOString()
  }
  return out
}

export function rangeLabel(f: ClosedTableFilters): string {
  switch (f.range) {
    case '7d':
      return 'Last 7 days'
    case '30d':
      return 'Last 30 days'
    case '90d':
      return 'Last 90 days'
    case 'custom':
      return [f.from, f.to].filter(Boolean).join(' to ') || 'Custom range'
    default:
      return 'Any time'
  }
}

export function useInboxFilters() {
  const list = ref<ListFilters>(defaultListFilters())
  const closed = ref<ClosedTableFilters>(defaultClosedFilters())
  return {
    list,
    closed,
    resetList: () => (list.value = defaultListFilters()),
    resetClosed: () => (closed.value = defaultClosedFilters()),
  }
}
