/**
 * Ticket status machine. One `transition()` helper, used by every ticket. Invalid transitions throw.
 *
 * new → researching → needs_decision → executing → closed | action_failed | waiting_on_customer
 * needs_decision ↔ snoozed
 * waiting_on_customer → researching (customer reply)
 * needs_decision → manual → closed (after reject)
 * executing → auto_pending → closed (Auto, undo window)
 * closed → researching (customer writes again)
 */

export const TICKET_STATUSES = [
  'new',
  'researching',
  'needs_decision',
  'executing',
  'closed',
  'action_failed',
  'waiting_on_customer',
  'snoozed',
  'manual',
  'auto_pending',
] as const

export type TicketStatus = (typeof TICKET_STATUSES)[number]

export const TICKET_RESOLUTIONS = [
  'approved',
  'approved_with_edits',
  'rejected',
  'handled_manually',
  'auto',
  'marked_done',
  'closed_no_reply',
] as const

export type TicketResolution = (typeof TICKET_RESOLUTIONS)[number]

export const TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  new: ['researching'],
  researching: ['needs_decision'],
  // researching: re-run / case override; manual: after reject
  needs_decision: ['executing', 'snoozed', 'manual', 'researching'],
  executing: ['closed', 'action_failed', 'waiting_on_customer', 'auto_pending'],
  // retry → executing, mark done → closed
  action_failed: ['executing', 'closed'],
  waiting_on_customer: ['researching'],
  // wake-up → needs_decision, customer wrote while snoozed → researching
  snoozed: ['needs_decision', 'researching'],
  // manual send runs actions → executing → closed; or straight to closed
  manual: ['closed', 'executing'],
  // undo window elapsed → closed, undo → needs_decision
  auto_pending: ['closed', 'needs_decision'],
  closed: ['researching'],
}

export class InvalidTransitionError extends Error {
  readonly from: TicketStatus
  readonly to: TicketStatus
  constructor(from: TicketStatus, to: TicketStatus) {
    super(`Invalid ticket transition: ${from} → ${to}`)
    this.name = 'InvalidTransitionError'
    this.from = from
    this.to = to
  }
}

export function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === 'string' && (TICKET_STATUSES as readonly string[]).includes(value)
}

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/**
 * Returns `to` when the transition is allowed, throws `InvalidTransitionError` otherwise.
 * Use it right before writing the new status so the write never happens on an invalid path.
 */
export function transition(from: TicketStatus, to: TicketStatus): TicketStatus {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to)
  return to
}

/** Statuses the inbox shows under "Needs decision". */
export const OPEN_STATUSES: readonly TicketStatus[] = [
  'new',
  'researching',
  'needs_decision',
  'executing',
  'action_failed',
  'manual',
]

/** Statuses the inbox shows under "Parked". */
export const PARKED_STATUSES: readonly TicketStatus[] = ['waiting_on_customer', 'snoozed']

export function isOpenStatus(s: TicketStatus): boolean {
  return OPEN_STATUSES.includes(s)
}

export const TICKET_STATUS_LABELS: Readonly<Record<TicketStatus, string>> = {
  new: 'New',
  researching: 'Researching',
  needs_decision: 'Needs decision',
  executing: 'Executing',
  closed: 'Closed',
  action_failed: 'Action failed',
  waiting_on_customer: 'Waiting on customer',
  snoozed: 'Snoozed',
  manual: 'Manual',
  auto_pending: 'Auto · undo window',
}

export const RESOLUTION_LABELS: Readonly<Record<TicketResolution, string>> = {
  approved: 'Approved',
  approved_with_edits: 'Approved with edits',
  rejected: 'Rejected',
  handled_manually: 'Handled manually',
  auto: 'Auto',
  marked_done: 'Marked done',
  closed_no_reply: 'Closed · no reply',
}
