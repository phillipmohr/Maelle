/**
 * The Postgres-backed job queue (IRDR-455). One row per job in `jobs`, one row per attempt in
 * `job_runs`. Claiming uses `FOR UPDATE SKIP LOCKED`, so any number of cron invocations can run
 * concurrently without handing the same job to two workers. See docs/adr/001-jobs.md.
 */
import type { JobPayloads, JobType } from '#shared/services'
import type { Db } from './db'
import {
  backoffMs,
  errorMessage,
  isRecurringJobType,
  jobDefaults,
  type EnqueueOptions,
  type JobRow,
  type JobRunRow,
} from './types'

export interface ClaimOptions {
  worker: string
  /** Only these types (a lane), default all. */
  types?: readonly JobType[]
  /** Never these types (e.g. long jobs when the time budget is nearly used up). */
  excludeTypes?: readonly JobType[]
}

export interface ExpiredJob {
  job: JobRow
  outcome: 'requeued' | 'dead' | 'failed'
}

export class JobQueue {
  constructor(readonly db: Db) {}

  /** Idempotent with `dedupeKey`: the second call returns the existing job and `created: false`. */
  async enqueue<T extends JobType>(
    type: T,
    payload: JobPayloads[T],
    opts: EnqueueOptions = {},
  ): Promise<{ job: JobRow; created: boolean }> {
    const d = jobDefaults(type)
    const params = [
      type,
      JSON.stringify(payload ?? {}),
      opts.runAt ?? new Date(),
      opts.maxAttempts ?? d.maxAttempts,
      opts.lockTtlSeconds ?? d.lockTtlSeconds,
      opts.dedupeKey ?? null,
    ]
    const insert = `insert into public.jobs (type, payload, run_at, max_attempts, lock_ttl_seconds, dedupe_key)
       values ($1, $2::jsonb, $3, $4, $5, $6)`
    if (opts.dedupeKey) {
      const rows = await this.db.query<JobRow>(
        `${insert} on conflict (dedupe_key) do nothing returning *`,
        params,
      )
      if (rows[0]) return { job: rows[0], created: true }
      const existing = await this.db.one<JobRow>(
        'select * from public.jobs where dedupe_key = $1',
        [opts.dedupeKey],
      )
      if (existing) return { job: existing, created: false }
      // The row vanished between the two statements (pruned); insert plainly.
      const retry = await this.db.query<JobRow>(`${insert} returning *`, params)
      return { job: retry[0]!, created: true }
    }
    const rows = await this.db.query<JobRow>(`${insert} returning *`, params)
    return { job: rows[0]!, created: true }
  }

  /**
   * Running jobs whose lock is older than their TTL were killed mid-way (function timeout, crash).
   * They are put back in the queue (attempt counted) or, when attempts are exhausted, dead-lettered
   * (recurring jobs: failed, the schedule fires the next run). Returns what happened to each.
   */
  async reapExpired(now: Date = new Date()): Promise<ExpiredJob[]> {
    return this.db.transaction(async (tx) => {
      const expired = await tx.query<JobRow>(
        `select * from public.jobs
         where status = 'running' and locked_at < $1::timestamptz - make_interval(secs => lock_ttl_seconds)
         order by locked_at asc
         limit 50
         for update skip locked`,
        [now],
      )
      const out: ExpiredJob[] = []
      for (const job of expired) {
        const exhausted = job.attempts >= job.max_attempts
        const status = !exhausted ? 'queued' : isRecurringJobType(job.type) ? 'failed' : 'dead'
        const outcome: ExpiredJob['outcome'] =
          status === 'queued' ? 'requeued' : status === 'dead' ? 'dead' : 'failed'
        const note = `lock expired after ${job.lock_ttl_seconds}s (worker ${job.locked_by ?? '?'} did not finish)`
        const updated = await tx.query<JobRow>(
          `update public.jobs set status = $2::text, run_at = $3::timestamptz, locked_at = null, locked_by = null,
             last_error = $4::text,
             finished_at = case when $2::text in ('dead', 'failed') then $3::timestamptz else null end
           where id = $1 returning *`,
          [job.id, status, now, note],
        )
        await tx.query(
          `update public.job_runs set status = 'expired', finished_at = $2,
             duration_ms = greatest(0, (extract(epoch from ($2::timestamptz - started_at)) * 1000)::int), error = $3
           where job_id = $1 and status = 'running'`,
          [job.id, now, note],
        )
        out.push({ job: updated[0]!, outcome })
      }
      return out
    })
  }

  /**
   * Claims the next due job for `worker` and opens its run history row. Returns null when nothing
   * is due. An `agent_run` is never claimed while another run for the same ticket holds a fresh lock.
   */
  async claim(opts: ClaimOptions): Promise<{ job: JobRow; run: JobRunRow } | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.query<JobRow>(
        `update public.jobs j
         set status = 'running', locked_at = clock_timestamp(), locked_by = $1, attempts = j.attempts + 1
         where j.id = (
           select c.id from public.jobs c
           where c.status in ('queued', 'failed')
             and c.run_at <= clock_timestamp()
             and c.attempts < c.max_attempts
             and ($2::text[] is null or c.type = any ($2::text[]))
             and ($3::text[] is null or not (c.type = any ($3::text[])))
             and not (
               c.type = 'agent_run' and exists (
                 select 1 from public.jobs r
                 where r.type = 'agent_run' and r.status = 'running' and r.id <> c.id
                   and r.payload ->> 'ticketId' = c.payload ->> 'ticketId'
                   and r.locked_at >= clock_timestamp() - make_interval(secs => r.lock_ttl_seconds)
               )
             )
           order by c.run_at asc, c.created_at asc
           limit 1
           for update skip locked
         )
         returning j.*`,
        [
          opts.worker,
          opts.types ? [...opts.types] : null,
          opts.excludeTypes ? [...opts.excludeTypes] : null,
        ],
      )
      const job = rows[0]
      if (!job) return null
      const runs = await tx.query<JobRunRow>(
        `insert into public.job_runs (job_id, attempt, worker) values ($1, $2, $3) returning *`,
        [job.id, job.attempts, opts.worker],
      )
      return { job, run: runs[0]! }
    })
  }

  async succeed(job: JobRow, run: JobRunRow, worker: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `update public.jobs set status = 'succeeded', finished_at = clock_timestamp(), locked_at = null, locked_by = null, last_error = null
         where id = $1 and status = 'running' and locked_by = $2`,
        [job.id, worker],
      )
      await tx.query(
        `update public.job_runs set status = 'succeeded', finished_at = clock_timestamp(),
           duration_ms = greatest(0, (extract(epoch from (clock_timestamp() - started_at)) * 1000)::int)
         where id = $1`,
        [run.id],
      )
    })
  }

  /**
   * Records a failed attempt. Retries with backoff while attempts remain; otherwise dead-letters
   * (recurring jobs end as `failed` instead, the schedule fires the next run).
   */
  async fail(
    job: JobRow,
    run: JobRunRow,
    worker: string,
    error: unknown,
    now: Date = new Date(),
  ): Promise<'retry' | 'dead' | 'failed'> {
    const message = errorMessage(error)
    const exhausted = job.attempts >= job.max_attempts
    const outcome: 'retry' | 'dead' | 'failed' = !exhausted
      ? 'retry'
      : isRecurringJobType(job.type)
        ? 'failed'
        : 'dead'
    const status = outcome === 'retry' ? 'failed' : outcome
    const runAt =
      outcome === 'retry'
        ? new Date(now.getTime() + backoffMs(job.attempts, jobDefaults(job.type)))
        : now
    await this.db.transaction(async (tx) => {
      await tx.query(
        `update public.jobs set status = $3::text, run_at = $4::timestamptz, last_error = $5::text, locked_at = null, locked_by = null,
           finished_at = case when $3::text in ('dead', 'failed') and $6::boolean then $7::timestamptz else null end
         where id = $1 and status = 'running' and locked_by = $2`,
        [job.id, worker, status, runAt, message, exhausted, now],
      )
      await tx.query(
        `update public.job_runs set status = 'failed', finished_at = $2,
           duration_ms = greatest(0, (extract(epoch from ($2::timestamptz - started_at)) * 1000)::int), error = $3
         where id = $1`,
        [run.id, now, message],
      )
    })
    return outcome
  }

  /** No handler registered yet: back to the queue after `delayMs`, attempt not counted. */
  async release(job: JobRow, run: JobRunRow, worker: string, delayMs: number, note: string) {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `update public.jobs set status = 'queued', run_at = clock_timestamp() + make_interval(secs => $3::double precision),
           attempts = greatest(0, attempts - 1), locked_at = null, locked_by = null, last_error = $4
         where id = $1 and status = 'running' and locked_by = $2`,
        [job.id, worker, delayMs / 1000, note],
      )
      await tx.query(
        `update public.job_runs set status = 'skipped', finished_at = clock_timestamp(), duration_ms = 0, error = $2 where id = $1`,
        [run.id, note],
      )
    })
  }

  async get(id: string): Promise<JobRow | null> {
    return this.db.one<JobRow>('select * from public.jobs where id = $1', [id])
  }

  async runsOf(jobId: string): Promise<JobRunRow[]> {
    return this.db.query<JobRunRow>(
      'select * from public.job_runs where job_id = $1 order by attempt asc',
      [jobId],
    )
  }

  /** True when a job of this type is queued, retrying, or running with a fresh lock. */
  async hasPendingOfType(type: JobType): Promise<boolean> {
    const row = await this.db.one<{ n: number }>(
      `select count(*)::int as n from public.jobs
       where type = $1 and (
         (status in ('queued', 'failed') and attempts < max_attempts)
         or (status = 'running' and locked_at >= clock_timestamp() - make_interval(secs => lock_ttl_seconds))
       )`,
      [type],
    )
    return (row?.n ?? 0) > 0
  }

  /** Deletes finished jobs (and their runs, by cascade) older than the retention window. */
  async prune(opts: { succeededAfterDays: number; othersAfterDays: number }): Promise<number> {
    const rows = await this.db.query<{ id: string }>(
      `delete from public.jobs
       where (status = 'succeeded' and finished_at < clock_timestamp() - make_interval(days => $1))
          or (status in ('dead', 'failed') and attempts >= max_attempts and finished_at < clock_timestamp() - make_interval(days => $2))
       returning id`,
      [opts.succeededAfterDays, opts.othersAfterDays],
    )
    return rows.length
  }
}
