/**
 * View model for the inbox and the ticket list: how a TicketListItem becomes a row. Pure functions
 * (no Nuxt APIs) so they are unit tested and shared by the inbox table, the 320px list and the
 * parked rows. Sorting: safety, then high risk, then age (oldest first).
 */
import type { AgentRunRow, DecisionKind, TicketListItem, TicketListResponse } from '#shared/api'
import { CASE_TYPES, caseLabel, caseShortLabel } from '#shared/case-types'
import { isOpenStatus, RESOLUTION_LABELS, type TicketResolution } from '#shared/status'
import type { PillStatus } from '~/components/ui/StatusPill.vue'
import type { RiskDotKind } from '~/components/ui/RiskDot.vue'
import { ageShort, clockTime, dayLabel, plural, shortDate } from '~/utils/format'

export type InboxItem = TicketListItem

/** Statuses that count as "need your decision" (research and execution do not need a hand). */
export const DECISION_STATUSES = ['needs_decision', 'action_failed', 'manual'] as const

export function isOpenItem(i: InboxItem): boolean {
  return isOpenStatus(i.status)
}

export function needsDecision(i: InboxItem): boolean {
  return (DECISION_STATUSES as readonly string[]).includes(i.status)
}

/**
 * Unsent drafts the inbox's 3-dot menu can regenerate: tickets waiting for a decision on a proposal.
 * The server decides the final set (reply present, no run queued); this is the count in the menu.
 */
export function regenerableDrafts(items: readonly InboxItem[]): InboxItem[] {
  return items.filter((i) => i.status === 'needs_decision' && i.proposalLine !== null)
}

/** Age of a ticket: since it was opened (the oldest waits first, whatever happened in between). */
export function ageBasis(i: InboxItem): string {
  return i.createdAt
}

function riskRank(i: InboxItem): number {
  return i.riskLevel === 'safety' ? 0 : i.riskLevel === 'high' ? 1 : 2
}

/** Open tickets in decision order: safety, high risk, then oldest first. */
export function needsDecisionRows(items: readonly InboxItem[]): InboxItem[] {
  return items
    .filter(isOpenItem)
    .sort((a, b) => riskRank(a) - riskRank(b) || ageBasis(a).localeCompare(ageBasis(b)))
}

export function waitingRows(items: readonly InboxItem[]): InboxItem[] {
  return items
    .filter((i) => i.status === 'waiting_on_customer')
    .sort((a, b) => ageBasis(a).localeCompare(ageBasis(b)))
}

export function snoozedRows(items: readonly InboxItem[]): InboxItem[] {
  return items
    .filter((i) => i.status === 'snoozed')
    .sort((a, b) => (a.snoozedUntil ?? '').localeCompare(b.snoozedUntil ?? ''))
}

export function autoRows(items: readonly InboxItem[]): InboxItem[] {
  return items
    .filter((i) => i.status === 'auto_pending')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function closedRows(items: readonly InboxItem[]): InboxItem[] {
  return items
    .filter((i) => i.status === 'closed')
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
}

export function decisionCount(items: readonly InboxItem[]): number {
  return items.filter(needsDecision).length
}

/** "5 need your decision · 11 closed in the last 3 days", or the cleared line. */
export function inboxSummary(
  counts: TicketListResponse['counts'],
  items: readonly InboxItem[],
): string {
  const open = needsDecisionRows(items).length
  if (open === 0) {
    return `Nothing open · ${counts.closedToday} closed today`
  }
  const n = decisionCount(items)
  const need = n === 1 ? '1 needs your decision' : `${n} need your decision`
  return `${need} · ${counts.closedLast3Days} closed in the last 3 days`
}

export function customerName(i: InboxItem): string {
  return i.customerName ?? i.customerEmail
}

/** Case column of the tables: the short label; "Classifying…" while the agent works. */
export function caseText(i: InboxItem): string {
  if (i.caseType) return caseShortLabel(i.caseType)
  if (i.importedAt) return 'Not classified yet'
  return i.status === 'researching' || i.status === 'new' ? 'Classifying…' : 'Unclear'
}

export function caseShort(i: InboxItem): string {
  if (i.caseType) return caseShortLabel(i.caseType)
  return i.status === 'researching' || i.status === 'new' ? 'Researching' : 'Unclear'
}

const SOURCE_ORDER = ['stripe', 'supabase', 'vercel', 'kb', 'linear', 'email'] as const
const SOURCE_LABEL: Record<(typeof SOURCE_ORDER)[number], string> = {
  stripe: 'Stripe',
  supabase: 'Supabase',
  vercel: 'Vercel',
  kb: 'KB',
  linear: 'Linear',
  email: 'Email',
}
const SOURCE_LONG: Record<(typeof SOURCE_ORDER)[number], string> = {
  stripe: 'Stripe billing',
  supabase: 'Supabase activity',
  vercel: 'Vercel logs',
  kb: 'the knowledge base',
  linear: 'Linear',
  email: 'the email history',
}

/** "Stripe ✓  Supabase ✓  Vercel ⋯  KB ✓" (skipped sources and the always-read email thread are left out). */
export function researchChecklist(progress: AgentRunRow['progress'] | null | undefined): string {
  if (!progress) return ''
  return SOURCE_ORDER.filter((k) => k !== 'email' && progress[k] && progress[k] !== 'skipped')
    .map((k) => {
      const v = progress[k]
      const mark = v === 'ok' ? '✓' : v === 'pending' ? '⋯' : '×'
      return `${SOURCE_LABEL[k]} ${mark}`
    })
    .join('  ')
}

/** "Researching · Vercel logs still loading" while the agent works. */
export function researchingLine(progress: AgentRunRow['progress'] | null | undefined): string {
  const pending = SOURCE_ORDER.filter((k) => progress?.[k] === 'pending')
  if (pending.length === 0) return 'Researching · classifying the case'
  const names = pending.map((k) => SOURCE_LONG[k].replace(/^the /, ''))
  return `Researching · ${names.join(' and ')} still loading`
}

export function rowPill(i: InboxItem): { status: PillStatus; label: string; dot?: boolean } {
  if (i.status === 'researching' || i.status === 'new')
    return { status: 'info', label: 'Researching' }
  if (i.status === 'executing') return { status: 'info', label: 'Executing' }
  if (i.status === 'action_failed') return { status: 'error', label: 'Action failed' }
  if (i.status === 'manual') return { status: 'neutral', label: 'Manual' }
  if (i.status === 'waiting_on_customer') return { status: 'info', label: 'Waiting on customer' }
  if (i.status === 'snoozed') return { status: 'neutral', label: 'Snoozed' }
  if (i.status === 'auto_pending')
    return { status: 'draft', label: 'Auto · undo window', dot: false }
  if (i.riskLevel === 'safety') return { status: 'error', label: 'Safety' }
  if (i.riskLevel === 'high') return { status: 'warning', label: 'High risk' }
  if (i.caseType === 'unclear') return { status: 'draft', label: 'Pick the case' }
  if (i.caseType && CASE_TYPES[i.caseType].requiresConfirmation) {
    if (i.stage === 1) return { status: 'info', label: 'Needs confirmation' }
    return { status: 'success', label: 'Customer confirmed' }
  }
  return { status: 'draft', label: 'Needs decision' }
}

export function rowDot(i: InboxItem): RiskDotKind {
  if (i.status === 'researching' || i.status === 'new') return 'research'
  if (i.status === 'action_failed') return 'failed'
  if (i.status === 'waiting_on_customer') return 'wait'
  if (i.status === 'snoozed') return 'snoozed'
  if (i.status === 'auto_pending') return 'auto'
  if (i.status === 'closed') return 'done'
  if (i.riskLevel === 'safety') return 'safety'
  if (i.riskLevel === 'high') return 'high'
  return 'none'
}

export function rowTint(i: InboxItem): 'none' | 'ember' | 'brick' | 'slate-blue' {
  if (i.status === 'action_failed') return 'brick'
  if (i.riskLevel === 'safety') return 'brick'
  if (i.riskLevel === 'high') return 'ember'
  return 'none'
}

/** Proposal column text. */
export function proposalText(i: InboxItem): string {
  if (i.status === 'researching' || i.status === 'new') return researchingLine(i.runProgress)
  return i.proposalLine ?? (i.caseType === 'unclear' ? 'Pick the case to get a proposal' : '')
}

/** "tomorrow at 09:00", "today at 20:00", "Oct 7 at 09:00" */
export function returnLabel(iso: string | null | undefined, now: Date): string {
  if (!iso) return 'later'
  const d = new Date(iso)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const time = clockTime(d)
  if (d.toDateString() === now.toDateString()) return `today at ${time}`
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow at ${time}`
  return `${shortDate(d, now)} at ${time}`
}

/** The 320px list subline: "Case · summary · N actions". */
export function listSubline(i: InboxItem, now: Date): string {
  const cs = caseShort(i)
  if (i.status === 'researching' || i.status === 'new') return 'Researching'
  if (i.status === 'waiting_on_customer') {
    const queued = Math.max(i.actionCount - 1, 0)
    const waiting = i.waitingFor ? `Waiting for “${i.waitingFor}”` : 'Waiting for a reply'
    return `${cs} · ${waiting}${queued > 0 ? ` · ${queued} queued` : ''}`
  }
  if (i.status === 'snoozed') return `${cs} · Returns ${returnLabel(i.snoozedUntil, now)}`
  if (i.status === 'action_failed')
    return `${cs} · Action failed · ${plural(i.actionCount, 'action')}`
  if (i.status === 'closed') return `${cs} · ${i.whatRan ?? 'closed'}`
  if (i.status === 'executing') return `${cs} · Executing · ${plural(i.actionCount, 'action')}`
  if (i.caseType === 'unclear') return `Unclear · pick the case`
  const confirm = i.caseType ? CASE_TYPES[i.caseType].requiresConfirmation : false
  let summary: string
  if (confirm && i.stage === 1) summary = 'Needs customer confirmation'
  else if (i.stage === 2) summary = 'Customer confirmed · stage 2'
  else {
    const subject = (i.subject ?? '').trim()
    const dup =
      !subject ||
      subject.toLowerCase() === cs.toLowerCase() ||
      subject.toLowerCase() === (i.caseType ? caseLabel(i.caseType).toLowerCase() : '')
    summary = dup ? (i.proposalLine ?? '') : subject
  }
  return [cs, summary, plural(i.actionCount, 'action')].filter(Boolean).join(' · ')
}

export function listTag(
  i: InboxItem,
): { text: string; tone: 'brick' | 'slate-blue' | 'ember' | 'sage' | 'sand' } | null {
  if (i.status === 'action_failed') return { text: 'Retry or mark done', tone: 'brick' }
  if (i.status === 'needs_decision' && i.stage === 2)
    return { text: 'Returned from waiting', tone: 'slate-blue' }
  if (i.status === 'auto_pending') return { text: 'Auto · undo window open', tone: 'sand' }
  return null
}

export function listTime(i: InboxItem, now: Date): string {
  if (i.status === 'snoozed' && i.snoozedUntil) return ageShort(i.snoozedUntil, now)
  if (i.status === 'closed' && i.closedAt) return ageShort(i.closedAt, now)
  return ageShort(ageBasis(i), now)
}

export interface ParkedGroup {
  key: 'waiting' | 'snoozed'
  name: string
  dot: RiskDotKind
  rows: InboxItem[]
  /** One line for the collapsed row: "Daniel Okafor · Refund request · waiting for “Yes, refund” since Sep 25". */
  text: string
}

export function parkedGroups(items: readonly InboxItem[], now: Date): ParkedGroup[] {
  const groups: ParkedGroup[] = []
  const waiting = waitingRows(items)
  if (waiting.length > 0) {
    const f = waiting[0]!
    const since = shortDate(f.lastMessageAt ?? f.updatedAt, now)
    const what = f.waitingFor ? `waiting for “${f.waitingFor}”` : 'waiting for a reply'
    const more = waiting.length > 1 ? ` · ${waiting.length - 1} more` : ''
    groups.push({
      key: 'waiting',
      name: 'Waiting on customer',
      dot: 'wait',
      rows: waiting,
      text: `${customerName(f)} · ${caseShort(f)} · ${what} since ${since}${more}`,
    })
  }
  const snoozed = snoozedRows(items)
  if (snoozed.length > 0) {
    const f = snoozed[0]!
    const more = snoozed.length > 1 ? ` · ${snoozed.length - 1} more` : ''
    groups.push({
      key: 'snoozed',
      name: 'Snoozed',
      dot: 'snoozed',
      rows: snoozed,
      text: `${customerName(f)} · ${caseShort(f)} · returns ${returnLabel(f.snoozedUntil, now)}${more}`,
    })
  }
  return groups
}

export interface DecisionPill {
  kind: 'pill' | 'plain'
  status: PillStatus
  label: string
  dot: boolean
}

/** Decision column of the closed table. An imported history ticket had no decision here at all. */
export function decisionPill(
  i: Pick<InboxItem, 'resolution' | 'decision'> & Partial<Pick<InboxItem, 'importedAt'>>,
): DecisionPill {
  const r: TicketResolution | DecisionKind | null = i.resolution ?? i.decision
  if (r == null && i.importedAt) {
    return { kind: 'plain', status: 'neutral', label: 'Imported', dot: false }
  }
  switch (r) {
    case 'approved':
      return { kind: 'pill', status: 'success', label: 'Approved', dot: true }
    case 'approved_with_edits':
      return { kind: 'pill', status: 'info', label: 'Approved with edits', dot: true }
    case 'rejected':
      return { kind: 'pill', status: 'error', label: 'Rejected', dot: true }
    case 'auto':
      return { kind: 'pill', status: 'draft', label: 'Auto', dot: false }
    case 'marked_done':
      return { kind: 'pill', status: 'neutral', label: RESOLUTION_LABELS.marked_done, dot: false }
    case 'closed_no_reply':
      return {
        kind: 'pill',
        status: 'neutral',
        label: RESOLUTION_LABELS.closed_no_reply,
        dot: false,
      }
    case 'handled_manually':
    default:
      return { kind: 'plain', status: 'neutral', label: 'Handled manually', dot: false }
  }
}

export interface DayGroup {
  day: string
  rows: InboxItem[]
}

/** Closed rows grouped by day ("Today", "Yesterday", "Sep 25"), in the order given. */
export function dayGroups(items: readonly InboxItem[], now: Date): DayGroup[] {
  const groups: DayGroup[] = []
  for (const i of items) {
    const day = i.closedAt ? dayLabel(i.closedAt, now) : 'Earlier'
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.rows.push(i)
    else groups.push({ day, rows: [i] })
  }
  return groups
}

/** The next open ticket after `id` (falls back to the previous one, then null). */
export function nextTicketNumber(
  items: readonly InboxItem[],
  currentDisplayNumber: number,
): number | null {
  const rows = needsDecisionRows(items).filter(
    (i) => i.status !== 'researching' && i.status !== 'new' && i.status !== 'executing',
  )
  const idx = rows.findIndex((i) => i.displayNumber === currentDisplayNumber)
  const candidates = rows.filter((i) => i.displayNumber !== currentDisplayNumber)
  if (candidates.length === 0) return null
  if (idx < 0) return candidates[0]!.displayNumber
  return (rows[idx + 1] ?? candidates[candidates.length - 1])!.displayNumber
}
