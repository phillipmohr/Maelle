/**
 * The two cron lanes (IRDR-455), see docs/adr/001-jobs.md:
 *  - tick: every minute. Evaluates the recurring schedule, runs due jobs within the time budget
 *    (an agent run may take 1 to 3 minutes), checks health, prunes old history once a day.
 *  - fetch-mail: every minute, fetch_mail only, so a long agent run never delays inbound mail.
 */
import type { CronAck } from '#shared/api'
import type { JobType, NotifyFn } from '#shared/services'
import { services } from '../utils/services'
import { poolDb, type Db } from './db'
import { checkHealth } from './health'
import { claimSlot } from './heartbeats'
import { JobQueue } from './queue'
import {
  defaultLog,
  DEFAULT_LONG_JOB_RESERVE_MS,
  runDueJobs,
  workerId,
  type RanJob,
} from './runner'
import { runSchedule } from './schedule'

export interface TickOptions {
  db?: Db
  now?: Date
  budgetMs?: number
  longJobReserveMs?: number
  worker?: string
  notify?: NotifyFn
  log?: (msg: string) => void
}

export interface TickResult extends CronAck {
  job: 'tick'
  scheduled: JobType[]
  jobs: RanJob[]
  alerts: string[]
  pruned: number
  durationMs: number
  worker: string
}

export interface FetchLaneResult extends CronAck {
  job: 'fetch_mail'
  scheduled: JobType[]
  jobs: RanJob[]
  /** Summary of the latest fetch (from mail_cursors.last_result). */
  fetch: Record<string, unknown> | null
  durationMs: number
  worker: string
}

export function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name])
  return Number.isFinite(v) && v > 0 ? v : fallback
}

function resolve(opts: TickOptions) {
  return {
    db: opts.db ?? poolDb(),
    now: opts.now ?? new Date(),
    worker: opts.worker ?? workerId(),
    log: opts.log ?? defaultLog,
    notify: opts.notify ?? (((kind, payload) => services.notify(kind, payload)) as NotifyFn),
  }
}

export async function runTick(opts: TickOptions = {}): Promise<TickResult> {
  const { db, now, worker, log, notify } = resolve(opts)
  const budgetMs = opts.budgetMs ?? envInt('JOBS_TICK_BUDGET_MS', 270_000)
  const t0 = Date.now()
  const schedule = await runSchedule(db, { now })
  const jobs = await runDueJobs({
    db,
    worker,
    budgetMs: budgetMs - (Date.now() - t0),
    longJobReserveMs:
      opts.longJobReserveMs ?? envInt('JOBS_LONG_JOB_RESERVE_MS', DEFAULT_LONG_JOB_RESERVE_MS),
    notify,
    log,
  })
  const alerts = await checkHealth(db, { now: new Date(), notify, log })
  const pruned = await pruneOncePerDay(db, now)
  return {
    ok: true,
    job: 'tick',
    ran: jobs.length,
    scheduled: schedule.enqueued,
    jobs,
    alerts,
    pruned,
    durationMs: Date.now() - t0,
    worker,
  }
}

export async function runFetchMailLane(opts: TickOptions = {}): Promise<FetchLaneResult> {
  const { db, now, worker, log, notify } = resolve(opts)
  const budgetMs = opts.budgetMs ?? envInt('JOBS_FETCH_LANE_BUDGET_MS', 50_000)
  const t0 = Date.now()
  const schedule = await runSchedule(db, { now, only: ['fetch_mail'] })
  const jobs = await runDueJobs({
    db,
    worker,
    budgetMs,
    types: ['fetch_mail'],
    maxJobs: 1,
    notify,
    log,
  })
  const cursor = await db.one<{ last_result: Record<string, unknown> | null }>(
    'select last_result from public.mail_cursors order by updated_at desc limit 1',
  )
  return {
    ok: true,
    job: 'fetch_mail',
    ran: jobs.length,
    scheduled: schedule.enqueued,
    jobs,
    fetch: cursor?.last_result ?? null,
    durationMs: Date.now() - t0,
    worker,
  }
}

/** Keeps the run history bounded: succeeded jobs 7 days, dead/failed 30 days, ignored mail 90 days. */
async function pruneOncePerDay(db: Db, now: Date): Promise<number> {
  const slot = now.toISOString().slice(0, 10)
  if (!(await claimSlot(db, 'prune_jobs', slot, 86_400, now))) return 0
  const pruned = await new JobQueue(db).prune({ succeededAfterDays: 7, othersAfterDays: 30 })
  await db.query(`delete from public.mail_ignored where created_at < now() - interval '90 days'`)
  return pruned
}
