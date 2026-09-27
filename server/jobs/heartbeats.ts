/**
 * Heartbeats for recurring jobs (IRDR-455): one row per recurring job with the last claimed
 * schedule slot, the last start/success/failure and the consecutive failure count. The schedule
 * claims a slot atomically, so two cron invocations in the same minute never enqueue the same run.
 */
import type { Db } from './db'
import type { JobHeartbeatRow } from './types'

/** Claims `slot` for `job`. False when this slot was already claimed. */
export async function claimSlot(
  db: Db,
  job: string,
  slot: string,
  intervalSeconds: number | null,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db.query<{ job: string }>(
    `insert into public.job_heartbeats as h (job, interval_seconds, last_slot, last_scheduled_at, updated_at)
     values ($1, $2, $3, $4, $4)
     on conflict (job) do update
       set last_slot = excluded.last_slot, last_scheduled_at = excluded.last_scheduled_at,
           interval_seconds = excluded.interval_seconds, updated_at = excluded.updated_at
       where h.last_slot is distinct from excluded.last_slot
     returning job`,
    [job, intervalSeconds, slot, now],
  )
  return rows.length > 0
}

export async function recordStart(db: Db, job: string, now: Date = new Date()): Promise<void> {
  await db.query(
    `insert into public.job_heartbeats as h (job, last_started_at, updated_at) values ($1, $2, $2)
     on conflict (job) do update set last_started_at = excluded.last_started_at, updated_at = excluded.updated_at`,
    [job, now],
  )
}

export async function recordSuccess(
  db: Db,
  job: string,
  now: Date = new Date(),
): Promise<JobHeartbeatRow> {
  const rows = await db.query<JobHeartbeatRow>(
    `insert into public.job_heartbeats as h (job, last_succeeded_at, consecutive_failures, last_error, updated_at)
     values ($1, $2, 0, null, $2)
     on conflict (job) do update
       set last_succeeded_at = excluded.last_succeeded_at, consecutive_failures = 0, last_error = null, updated_at = excluded.updated_at
     returning *`,
    [job, now],
  )
  return rows[0]!
}

export async function recordFailure(
  db: Db,
  job: string,
  error: string,
  now: Date = new Date(),
): Promise<JobHeartbeatRow> {
  const rows = await db.query<JobHeartbeatRow>(
    `insert into public.job_heartbeats as h (job, last_failed_at, consecutive_failures, last_error, updated_at)
     values ($1, $2, 1, $3, $2)
     on conflict (job) do update
       set last_failed_at = excluded.last_failed_at, consecutive_failures = h.consecutive_failures + 1,
           last_error = excluded.last_error, updated_at = excluded.updated_at
     returning *`,
    [job, now, error.slice(0, 4000)],
  )
  return rows[0]!
}

export async function markAlerted(db: Db, job: string, now: Date = new Date()): Promise<void> {
  await db.query(
    `update public.job_heartbeats set last_alert_at = $2, updated_at = $2 where job = $1`,
    [job, now],
  )
}

export async function getHeartbeat(db: Db, job: string): Promise<JobHeartbeatRow | null> {
  return db.one<JobHeartbeatRow>('select * from public.job_heartbeats where job = $1', [job])
}

export async function listHeartbeats(db: Db): Promise<JobHeartbeatRow[]> {
  return db.query<JobHeartbeatRow>('select * from public.job_heartbeats order by job')
}
