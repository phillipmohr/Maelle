/**
 * Job runner (IRDR-455): claims due jobs one at a time within a wall-clock budget and runs the
 * registered handler. Failures retry with backoff, exhausted jobs are dead-lettered with an alert,
 * a job without a handler is put back for later (log, never crash), and recurring jobs update
 * their heartbeat so the health check can alert on repeated failures.
 */
import { randomUUID } from 'node:crypto'
import type { JobType, NotifyFn, NotifyPayloads } from '#shared/services'
import { services } from '../utils/services'
import type { Db } from './db'
import { recordFailure, recordStart, recordSuccess } from './heartbeats'
import { JobQueue } from './queue'
import { handlerRegistry } from './registry'
import { recurringJobDef } from './schedule'
import {
  errorMessage,
  isRecurringJobType,
  LONG_JOB_TYPES,
  type JobRow,
  type JobRunRow,
} from './types'

/** Stop claiming when less than this is left of the budget. */
const MIN_REMAINING_MS = 5_000
export const DEFAULT_LONG_JOB_RESERVE_MS = 200_000
const MISSING_HANDLER_DELAY_MS = 60_000

export interface RunnerOptions {
  db: Db
  worker?: string
  /** Wall-clock budget for this call (the cron function's max duration minus a margin). */
  budgetMs: number
  /** Long jobs (agent runs) are claimed only while at least this much budget remains. */
  longJobReserveMs?: number
  /** Only these types (a lane); default all. */
  types?: readonly JobType[]
  maxJobs?: number
  notify?: NotifyFn
  log?: (msg: string) => void
  now?: () => Date
  missingHandlerDelayMs?: number
}

export interface RanJob {
  id: string
  type: JobType
  attempt: number
  outcome: 'succeeded' | 'retry' | 'dead' | 'failed' | 'skipped'
  error?: string
  durationMs: number
}

export function workerId(): string {
  const host = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_REGION || 'local'
  return `${host}:${process.pid}:${randomUUID().slice(0, 8)}`
}

export function defaultLog(msg: string): void {
  if (process.env.NODE_ENV !== 'test') console.info(msg)
}

export function shouldAlertOnFailures(consecutive: number, threshold: number): boolean {
  if (threshold <= 0) return false
  return (
    consecutive === threshold || (consecutive > threshold && (consecutive - threshold) % 60 === 0)
  )
}

export async function safeNotify(
  notify: NotifyFn,
  payload: NotifyPayloads['system_alert'],
  log: (msg: string) => void,
): Promise<void> {
  try {
    await notify('system_alert', payload)
  } catch (e) {
    log(`[jobs] notify failed: ${errorMessage(e)} (alert was: ${payload.title})`)
  }
}

export async function runDueJobs(opts: RunnerOptions): Promise<RanJob[]> {
  const worker = opts.worker ?? workerId()
  const log = opts.log ?? defaultLog
  const notify: NotifyFn = opts.notify ?? ((kind, payload) => services.notify(kind, payload))
  const queue = new JobQueue(opts.db)
  const deadline = Date.now() + opts.budgetMs
  const reserve = opts.longJobReserveMs ?? DEFAULT_LONG_JOB_RESERVE_MS
  const ran: RanJob[] = []

  for (const e of await queue.reapExpired(opts.now?.())) {
    log(`[jobs] ${e.job.type} ${e.job.id}: ${e.job.last_error} → ${e.outcome}`)
    if (isRecurringJobType(e.job.type)) {
      await recordFailure(opts.db, e.job.type, e.job.last_error ?? 'lock expired')
    }
    if (e.outcome === 'dead') await alertDead(notify, e.job, log)
  }

  while (ran.length < (opts.maxJobs ?? Number.POSITIVE_INFINITY)) {
    const remaining = deadline - Date.now()
    if (remaining < MIN_REMAINING_MS) break
    const claimed = await queue.claim({
      worker,
      types: opts.types,
      excludeTypes: remaining < reserve ? LONG_JOB_TYPES : undefined,
    })
    if (!claimed) break
    ran.push(
      await executeClaimed(claimed.job, claimed.run, {
        db: opts.db,
        queue,
        worker,
        notify,
        log,
        missingHandlerDelayMs: opts.missingHandlerDelayMs ?? MISSING_HANDLER_DELAY_MS,
      }),
    )
  }
  return ran
}

interface ExecContext {
  db: Db
  queue: JobQueue
  worker: string
  notify: NotifyFn
  log: (msg: string) => void
  missingHandlerDelayMs: number
}

async function executeClaimed(job: JobRow, run: JobRunRow, ctx: ExecContext): Promise<RanJob> {
  const t0 = Date.now()
  const base = { id: job.id, type: job.type, attempt: job.attempts }
  const handler = handlerRegistry().get(job.type)
  if (!handler) {
    const note = `no handler registered for ${job.type}`
    await ctx.queue.release(job, run, ctx.worker, ctx.missingHandlerDelayMs, note)
    ctx.log(`[jobs] ${note}; job ${job.id} will be looked at again later`)
    return { ...base, outcome: 'skipped', error: note, durationMs: Date.now() - t0 }
  }
  const recurring = isRecurringJobType(job.type)
  if (recurring) await recordStart(ctx.db, job.type)
  try {
    await handler(job.payload as never, { jobId: job.id, attempt: job.attempts })
    await ctx.queue.succeed(job, run, ctx.worker)
    if (recurring) await recordSuccess(ctx.db, job.type)
    return { ...base, outcome: 'succeeded', durationMs: Date.now() - t0 }
  } catch (e) {
    const message = errorMessage(e)
    const outcome = await ctx.queue.fail(job, run, ctx.worker, e)
    ctx.log(`[jobs] ${job.type} ${job.id} attempt ${job.attempts} failed (${outcome}): ${message}`)
    if (recurring) {
      const hb = await recordFailure(ctx.db, job.type, message)
      const def = recurringJobDef(job.type)
      if (def && shouldAlertOnFailures(hb.consecutive_failures, def.alertAfterFailures)) {
        await safeNotify(
          ctx.notify,
          {
            title: `${job.type} failed ${hb.consecutive_failures} times in a row`,
            detail: message,
            source: 'jobs',
          },
          ctx.log,
        )
      }
    }
    if (outcome === 'dead') await alertDead(ctx.notify, { ...job, last_error: message }, ctx.log)
    return { ...base, outcome, error: message, durationMs: Date.now() - t0 }
  }
}

async function alertDead(notify: NotifyFn, job: JobRow, log: (msg: string) => void) {
  await safeNotify(
    notify,
    {
      title: `Job ${job.type} moved to dead-letter`,
      detail: `Job ${job.id} gave up after ${job.attempts} attempt(s). Payload ${JSON.stringify(job.payload)}. Last error: ${job.last_error ?? 'unknown'}`,
      source: 'jobs',
    },
    log,
  )
}
