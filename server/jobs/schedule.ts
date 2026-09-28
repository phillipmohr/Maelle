/**
 * Recurring schedule (IRDR-455). Evaluated on every tick from `job_heartbeats`: each recurring job
 * has a slot (a minute bucket, or the local date for the daily digest). The first tick that sees a
 * new slot claims it atomically and enqueues one job; a late tick still runs a slot that was
 * missed (never missed), a second tick in the same slot finds it claimed (never doubled).
 */
import type { JobType } from '#shared/services'
import type { Db } from './db'
import { claimSlot } from './heartbeats'
import { JobQueue } from './queue'

export interface RecurringJobDef {
  type: JobType
  /** Interval in seconds; omitted for the daily digest. */
  every?: number
  daily?: boolean
  /** Alert after this many consecutive failures (and again every 60 after that). */
  alertAfterFailures: number
  /** Alert when the last success is older than this many seconds. */
  staleAfterSeconds?: number
}

export const RECURRING_JOBS: readonly RecurringJobDef[] = [
  { type: 'fetch_mail', every: 60, alertAfterFailures: 3, staleAfterSeconds: 15 * 60 },
  { type: 'run_due_scheduled', every: 60, alertAfterFailures: 5, staleAfterSeconds: 30 * 60 },
  { type: 'wake_snoozed', every: 60, alertAfterFailures: 5, staleAfterSeconds: 30 * 60 },
  { type: 'waiting_follow_up', every: 300, alertAfterFailures: 3, staleAfterSeconds: 60 * 60 },
  { type: 'daily_digest', daily: true, alertAfterFailures: 1 },
]

export function recurringJobDef(type: string): RecurringJobDef | undefined {
  return RECURRING_JOBS.find((d) => d.type === type)
}

/** ISO minute bucket, e.g. `2026-09-27T20:58Z` for a 60 s interval. */
export function intervalSlot(now: Date, everySeconds: number): string {
  const ms = everySeconds * 1000
  const floored = new Date(Math.floor(now.getTime() / ms) * ms)
  return floored.toISOString().replace(/:\d{2}\.\d{3}Z$/, 'Z')
}

/** Local date and minutes since midnight of `now` in `timeZone` (falls back to UTC when invalid). */
export function localDateTime(now: Date, timeZone: string): { date: string; minutes: number } {
  let fmt: Intl.DateTimeFormat
  try {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
  } catch {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
  }
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]))
  const hour = Number(parts.hour) % 24
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
  }
}

/** Parses `HH:MM` or `HH:MM:SS` into minutes since midnight. */
export function timeToMinutes(time: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(time.trim())
  if (!m) return 8 * 60
  return Number(m[1]) * 60 + Number(m[2])
}

/**
 * The digest slot (local date) when the digest is due now, else null. Due means: local time in
 * `timezone` is at or past `digestTime`. Combined with the slot claim this fires exactly once a day,
 * even when the tick at the configured minute was missed.
 */
export function digestSlot(
  now: Date,
  settings: { digestTime: string; timezone: string },
): string | null {
  const local = localDateTime(now, settings.timezone)
  return local.minutes >= timeToMinutes(settings.digestTime) ? local.date : null
}

export interface DigestSettings {
  digestTime: string
  timezone: string
}

export async function loadDigestSettings(db: Db): Promise<DigestSettings | null> {
  const row = await db.one<{ digest_time: string; timezone: string }>(
    `select s.digest_time::text as digest_time, s.timezone
     from public.settings s join public.apps a on a.id = s.app_id
     order by (a.key = 'instaradar') desc, s.updated_at desc
     limit 1`,
  )
  return row ? { digestTime: row.digest_time, timezone: row.timezone } : null
}

export interface ScheduleResult {
  enqueued: JobType[]
  /** Slot already claimed, or a previous instance still pending. */
  skipped: JobType[]
}

/**
 * Enqueues every recurring job whose slot is due and unclaimed. At most one instance of a recurring
 * job is pending at a time (a missing handler therefore never piles up jobs).
 */
export async function runSchedule(
  db: Db,
  opts: { now?: Date; only?: readonly JobType[] } = {},
): Promise<ScheduleResult> {
  const now = opts.now ?? new Date()
  const queue = new JobQueue(db)
  const result: ScheduleResult = { enqueued: [], skipped: [] }
  let digest: DigestSettings | null | undefined
  for (const def of RECURRING_JOBS) {
    if (opts.only && !opts.only.includes(def.type)) continue
    let slot: string | null
    if (def.every) {
      slot = intervalSlot(now, def.every)
    } else {
      if (digest === undefined) digest = await loadDigestSettings(db)
      slot = digest ? digestSlot(now, digest) : null
    }
    if (!slot) continue
    if (await queue.hasPendingOfType(def.type)) {
      result.skipped.push(def.type)
      continue
    }
    const claimed = await claimSlot(db, def.type, slot, def.every ?? null, now)
    if (!claimed) {
      result.skipped.push(def.type)
      continue
    }
    await queue.enqueue(def.type, {} as never, { dedupeKey: `${def.type}:${slot}`, runAt: now })
    result.enqueued.push(def.type)
  }
  return result
}
