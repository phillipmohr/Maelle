/**
 * Recurring ticket timers owned by the mail/jobs ticket (IRDR-455):
 *  - wake_snoozed: snoozed tickets whose `snoozed_until` passed go back to needs_decision.
 *  - waiting_follow_up: tickets waiting on the customer get a `follow_up` agent run after
 *    settings.follow_up_days (the agent drafts a follow-up) and another one after
 *    settings.auto_close_days (the agent proposes closing). Each fires once per waiting period.
 */
import { followUpKindDue, type FollowUpKind } from '#shared/follow-up'
import { transition } from '#shared/status'
import type { Db } from './db'
import { JobQueue } from './queue'

export async function wakeSnoozed(db: Db, now: Date = new Date()): Promise<string[]> {
  const to = transition('snoozed', 'needs_decision')
  const rows = await db.query<{ id: string }>(
    `update public.tickets set status = $1, snoozed_until = null
     where status = 'snoozed' and snoozed_until is not null and snoozed_until <= $2
     returning id`,
    [to, now],
  )
  return rows.map((r) => r.id)
}

export interface FollowUpRun {
  ticketId: string
  kind: FollowUpKind
  jobId: string
}

interface WaitingRow {
  id: string
  waiting_since: Date
  follow_up_days: number
  auto_close_days: number
}

/** Tickets waiting on the customer with the start of their waiting period and the app's settings. */
const WAITING_SQL = `
  select t.id,
    coalesce(
      (select min(m.sent_at) from public.messages m
        where m.ticket_id = t.id and m.direction = 'out' and m.sent_at is not null
          and m.sent_at > coalesce(t.last_customer_message_at, '-infinity'::timestamptz)),
      t.updated_at
    ) as waiting_since,
    s.follow_up_days, s.auto_close_days
  from public.tickets t
  join public.settings s on s.app_id = t.app_id
  where t.status = 'waiting_on_customer'`

export async function runWaitingFollowUps(db: Db, now: Date = new Date()): Promise<FollowUpRun[]> {
  const rows = await db.query<WaitingRow>(WAITING_SQL)
  const out: FollowUpRun[] = []
  for (const r of rows) {
    const kind = followUpKindDue(
      { followUpDays: r.follow_up_days, autoCloseDays: r.auto_close_days },
      r.waiting_since,
      now,
    )
    if (!kind) continue
    const run = await db.transaction(async (tx) => {
      const inserted = await tx.query<{ id: string }>(
        `insert into public.ticket_follow_ups (ticket_id, kind, waiting_since) values ($1, $2, $3)
         on conflict (ticket_id, kind, waiting_since) do nothing returning id`,
        [r.id, kind, r.waiting_since],
      )
      if (!inserted[0]) return null
      const { job } = await new JobQueue(tx).enqueue(
        'agent_run',
        { ticketId: r.id, trigger: 'follow_up' },
        {
          dedupeKey: `agent_run:${r.id}:follow_up:${kind}:${r.waiting_since.toISOString()}`,
          runAt: now,
        },
      )
      await tx.query('update public.ticket_follow_ups set job_id = $2 where id = $1', [
        inserted[0].id,
        job.id,
      ])
      return { ticketId: r.id, kind, jobId: job.id }
    })
    if (run) out.push(run)
  }
  return out
}
