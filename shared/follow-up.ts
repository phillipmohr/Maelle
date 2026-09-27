/**
 * Follow-up timer for tickets that wait on the customer (IRDR-455). Shared so the job runner that
 * enqueues the `follow_up` agent run and the agent that drafts it agree on which kind is due.
 *
 * The waiting period starts with our first reply after the customer's last message
 * (`ticket_follow_ups.waiting_since`). After `followUpDays` the agent drafts a friendly follow-up,
 * after `autoCloseDays` it proposes closing the ticket. Each kind fires once per waiting period.
 */

export const FOLLOW_UP_KINDS = ['follow_up', 'auto_close'] as const
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number]

export interface FollowUpSettings {
  followUpDays: number
  autoCloseDays: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/** The most advanced follow-up kind that is due, or null while the customer still has time. */
export function followUpKindDue(
  settings: FollowUpSettings,
  waitingSince: Date,
  now: Date,
): FollowUpKind | null {
  const days = (now.getTime() - waitingSince.getTime()) / DAY_MS
  if (settings.autoCloseDays > 0 && days >= settings.autoCloseDays) return 'auto_close'
  if (settings.followUpDays > 0 && days >= settings.followUpDays) return 'follow_up'
  return null
}
