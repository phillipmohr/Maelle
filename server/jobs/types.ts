/**
 * Job runner types and per-type defaults (IRDR-455). Job types and payloads are the binding
 * contract in shared/services.ts; this file only adds the runner's view of them.
 */
import type { JobType } from '#shared/services'

export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'dead'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export interface JobRow {
  id: string
  type: JobType
  payload: Record<string, unknown>
  status: JobStatus
  run_at: Date
  attempts: number
  max_attempts: number
  lock_ttl_seconds: number
  last_error: string | null
  locked_at: Date | null
  locked_by: string | null
  dedupe_key: string | null
  finished_at: Date | null
  created_at: Date
  updated_at: Date
}

export interface JobRunRow {
  id: string
  job_id: string
  attempt: number
  status: 'running' | 'succeeded' | 'failed' | 'expired' | 'skipped'
  worker: string | null
  started_at: Date
  finished_at: Date | null
  duration_ms: number | null
  error: string | null
}

export interface JobHeartbeatRow {
  job: string
  interval_seconds: number | null
  last_slot: string | null
  last_scheduled_at: Date | null
  last_started_at: Date | null
  last_succeeded_at: Date | null
  last_failed_at: Date | null
  consecutive_failures: number
  last_error: string | null
  last_alert_at: Date | null
  created_at: Date
  updated_at: Date
}

export interface EnqueueOptions {
  runAt?: Date
  /** Same key, same job: a second enqueue returns the existing job. */
  dedupeKey?: string
  maxAttempts?: number
  lockTtlSeconds?: number
}

export interface JobTypeDefaults {
  maxAttempts: number
  lockTtlSeconds: number
  /** First retry delay; doubles per attempt, capped by `backoffCapMs`. */
  backoffBaseMs: number
  backoffCapMs: number
}

/** Recurring jobs are driven by the schedule (job_heartbeats), never dead-lettered. */
export const RECURRING_JOB_TYPES = [
  'fetch_mail',
  'wake_snoozed',
  'waiting_follow_up',
  'run_due_scheduled',
  'daily_digest',
] as const satisfies readonly JobType[]

export function isRecurringJobType(type: string): boolean {
  return (RECURRING_JOB_TYPES as readonly string[]).includes(type)
}

/** Jobs that can take minutes (an agent run is 1 to 3 minutes). Claimed only with enough budget left. */
export const LONG_JOB_TYPES = ['agent_run'] as const satisfies readonly JobType[]

const MINUTE = 60_000

export const JOB_TYPE_DEFAULTS: Record<JobType, JobTypeDefaults> = {
  agent_run: {
    maxAttempts: 4,
    lockTtlSeconds: 600,
    backoffBaseMs: MINUTE,
    backoffCapMs: 30 * MINUTE,
  },
  send_reply: {
    maxAttempts: 5,
    lockTtlSeconds: 300,
    backoffBaseMs: 30_000,
    backoffCapMs: 15 * MINUTE,
  },
  send_system_email: {
    maxAttempts: 5,
    lockTtlSeconds: 300,
    backoffBaseMs: 30_000,
    backoffCapMs: 15 * MINUTE,
  },
  // Recurring: one attempt, the schedule fires the next run anyway.
  fetch_mail: { maxAttempts: 1, lockTtlSeconds: 240, backoffBaseMs: MINUTE, backoffCapMs: MINUTE },
  wake_snoozed: {
    maxAttempts: 1,
    lockTtlSeconds: 120,
    backoffBaseMs: MINUTE,
    backoffCapMs: MINUTE,
  },
  waiting_follow_up: {
    maxAttempts: 1,
    lockTtlSeconds: 120,
    backoffBaseMs: MINUTE,
    backoffCapMs: MINUTE,
  },
  run_due_scheduled: {
    maxAttempts: 1,
    lockTtlSeconds: 300,
    backoffBaseMs: MINUTE,
    backoffCapMs: MINUTE,
  },
  // The digest is worth a few retries within the day.
  daily_digest: {
    maxAttempts: 3,
    lockTtlSeconds: 600,
    backoffBaseMs: 5 * MINUTE,
    backoffCapMs: 30 * MINUTE,
  },
}

export function jobDefaults(type: JobType): JobTypeDefaults {
  return JOB_TYPE_DEFAULTS[type] ?? JOB_TYPE_DEFAULTS.send_system_email
}

/**
 * Exponential backoff with up to 20 % jitter: base × 2^(attempt-1), capped.
 * `attempt` is the attempt that just failed (1-based).
 */
export function backoffMs(
  attempt: number,
  d: Pick<JobTypeDefaults, 'backoffBaseMs' | 'backoffCapMs'>,
  random: () => number = Math.random,
): number {
  const exp = Math.min(d.backoffBaseMs * 2 ** Math.max(0, attempt - 1), d.backoffCapMs)
  return Math.round(exp * (1 + 0.2 * random()))
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`.slice(0, 4000)
  return String(e).slice(0, 4000)
}
