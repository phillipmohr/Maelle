/** Job queue: enqueue, claim, retry, dead-letter, expired locks, concurrency. Run with `pnpm test:db`. */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { poolDb } from '../../../server/jobs/db'
import { JobQueue } from '../../../server/jobs/queue'
import { resetJobHandlersForTests } from '../../../server/jobs/registry'
import { runDueJobs } from '../../../server/jobs/runner'
import { createJobsService } from '../../../server/jobs/service'
import { closeDbForTests } from '../../../server/utils/db'
import { notifySpy } from './_db'

const url = process.env.TEST_DATABASE_URL
const runId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const key = (s: string) => `test:${runId}:${s}`
const mail = { to: 'phillip@example.com', subject: 'test', body: 'test' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!url)('job queue', () => {
  const db = poolDb()
  const queue = new JobQueue(db)
  const jobs = createJobsService({ db })

  beforeEach(() => resetJobHandlersForTests())
  afterAll(async () => {
    await db.query('delete from public.jobs where dedupe_key like $1', [`test:${runId}:%`])
    await closeDbForTests()
  })

  it('enqueue is idempotent by dedupe key and the facade returns a handle', async () => {
    const later = new Date('2030-01-01T00:00:00Z')
    const a = await queue.enqueue('send_system_email', mail, {
      dedupeKey: key('dedupe'),
      runAt: later,
    })
    const b = await queue.enqueue('send_system_email', mail, {
      dedupeKey: key('dedupe'),
      runAt: later,
    })
    expect(a.created).toBe(true)
    expect(b.created).toBe(false)
    expect(b.job.id).toBe(a.job.id)
    expect(a.job).toMatchObject({
      status: 'queued',
      attempts: 0,
      max_attempts: 5,
      lock_ttl_seconds: 300,
    })
    const handle = await jobs.enqueueWith('send_system_email', mail, {
      dedupeKey: key('handle'),
      runAt: new Date('2030-01-01T00:00:00Z'),
    })
    expect(handle).toMatchObject({
      type: 'send_system_email',
      runAt: '2030-01-01T00:00:00.000Z',
      created: true,
    })
  })

  it('runs a due job with its handler and records the run history', async () => {
    const calls: unknown[] = []
    jobs.registerHandler('send_system_email', async (payload, ctx) => {
      calls.push({ payload, ctx })
    })
    const { job } = await queue.enqueue('send_system_email', mail, { dedupeKey: key('ok') })
    const ran = await runDueJobs({
      db,
      worker: 'w-ok',
      budgetMs: 10_000,
      types: ['send_system_email'],
      notify: notifySpy(),
      log: () => {},
    })
    expect(ran.map((r) => r.id)).toContain(job.id)
    expect(ran.find((r) => r.id === job.id)).toMatchObject({ outcome: 'succeeded', attempt: 1 })
    expect(calls).toEqual([{ payload: mail, ctx: { jobId: job.id, attempt: 1 } }])
    const row = (await queue.get(job.id))!
    expect(row).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      locked_by: null,
      locked_at: null,
    })
    expect(row.finished_at).toBeInstanceOf(Date)
    const runs = await queue.runsOf(job.id)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ attempt: 1, status: 'succeeded', worker: 'w-ok' })
    expect(runs[0]!.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('retries a failing job with backoff, then dead-letters it with an alert', async () => {
    jobs.registerHandler('send_system_email', async () => {
      throw new Error('boom')
    })
    const notify = notifySpy()
    const { job } = await queue.enqueue('send_system_email', mail, {
      dedupeKey: key('fail'),
      maxAttempts: 2,
    })
    const first = await runDueJobs({
      db,
      worker: 'w-fail',
      budgetMs: 10_000,
      types: ['send_system_email'],
      notify,
      log: () => {},
    })
    expect(first.find((r) => r.id === job.id)).toMatchObject({
      outcome: 'retry',
      error: 'Error: boom',
    })
    let row = (await queue.get(job.id))!
    expect(row).toMatchObject({ status: 'failed', attempts: 1 })
    expect(row.run_at.getTime()).toBeGreaterThan(Date.now())
    expect(row.last_error).toContain('boom')
    expect(notify.calls).toHaveLength(0)
    // Not due yet: nothing happens.
    const idle = await runDueJobs({
      db,
      worker: 'w-fail',
      budgetMs: 10_000,
      types: ['send_system_email'],
      notify,
      log: () => {},
    })
    expect(idle.map((r) => r.id)).not.toContain(job.id)

    await db.query('update public.jobs set run_at = now() where id = $1', [job.id])
    const second = await runDueJobs({
      db,
      worker: 'w-fail',
      budgetMs: 10_000,
      types: ['send_system_email'],
      notify,
      log: () => {},
    })
    expect(second.find((r) => r.id === job.id)).toMatchObject({ outcome: 'dead', attempt: 2 })
    row = (await queue.get(job.id))!
    expect(row).toMatchObject({ status: 'dead', attempts: 2 })
    expect(notify.calls).toHaveLength(1)
    expect(notify.calls[0]!.kind).toBe('system_alert')
    expect((notify.calls[0]!.payload as { title: string }).title).toContain('dead-letter')
    expect((await queue.runsOf(job.id)).map((r) => r.status)).toEqual(['failed', 'failed'])
    // Dead jobs are never claimed again.
    await db.query('update public.jobs set run_at = now() where id = $1', [job.id])
    const third = await runDueJobs({
      db,
      worker: 'w-fail',
      budgetMs: 10_000,
      types: ['send_system_email'],
      notify,
      log: () => {},
    })
    expect(third.map((r) => r.id)).not.toContain(job.id)
  })

  it('keeps a job whose handler is not registered yet and looks at it again later', async () => {
    const { job } = await queue.enqueue(
      'send_reply',
      { ticketId: 't', executionId: 'e' },
      { dedupeKey: key('nohandler') },
    )
    const ran = await runDueJobs({
      db,
      worker: 'w-nh',
      budgetMs: 10_000,
      types: ['send_reply'],
      notify: notifySpy(),
      log: () => {},
    })
    expect(ran.find((r) => r.id === job.id)).toMatchObject({ outcome: 'skipped' })
    const row = (await queue.get(job.id))!
    expect(row).toMatchObject({ status: 'queued', attempts: 0, locked_by: null })
    expect(row.run_at.getTime()).toBeGreaterThan(Date.now() + 30_000)
    expect(row.last_error).toBe('no handler registered for send_reply')
    expect((await queue.runsOf(job.id)).map((r) => r.status)).toEqual(['skipped'])
  })

  it('two workers never claim the same job', async () => {
    jobs.registerHandler('send_system_email', async () => {
      await sleep(20)
    })
    const ids = new Set<string>()
    for (let i = 0; i < 6; i++) {
      const { job } = await queue.enqueue('send_system_email', mail, {
        dedupeKey: key(`conc-${i}`),
      })
      ids.add(job.id)
    }
    const opts = {
      db,
      budgetMs: 10_000,
      types: ['send_system_email'] as const,
      notify: notifySpy(),
      log: () => {},
    }
    const [a, b] = await Promise.all([
      runDueJobs({ ...opts, worker: 'A' }),
      runDueJobs({ ...opts, worker: 'B' }),
    ])
    const mine = [...a, ...b].filter((r) => ids.has(r.id))
    expect(mine).toHaveLength(6)
    expect(new Set(mine.map((r) => r.id)).size).toBe(6)
    expect(mine.every((r) => r.outcome === 'succeeded')).toBe(true)
  })

  it('a killed run is re-claimed once its lock expires, with the history showing it', async () => {
    let calls = 0
    jobs.registerHandler('send_system_email', async () => {
      calls++
    })
    const { job } = await queue.enqueue('send_system_email', mail, { dedupeKey: key('killed') })
    const claimed = await queue.claim({ worker: 'dead-worker', types: ['send_system_email'] })
    expect(claimed?.job.id).toBe(job.id)
    // The worker dies here. Nothing happens while the lock is fresh…
    const early = await runDueJobs({
      db,
      worker: 'w-k',
      budgetMs: 10_000,
      types: ['send_system_email'],
      notify: notifySpy(),
      log: () => {},
    })
    expect(early.map((r) => r.id)).not.toContain(job.id)
    // …and once the lock is older than its TTL the job runs again.
    await db.query(`update public.jobs set locked_at = now() - interval '2 hours' where id = $1`, [
      job.id,
    ])
    const later = await runDueJobs({
      db,
      worker: 'w-k',
      budgetMs: 10_000,
      types: ['send_system_email'],
      notify: notifySpy(),
      log: () => {},
    })
    expect(later.find((r) => r.id === job.id)).toMatchObject({ outcome: 'succeeded', attempt: 2 })
    expect(calls).toBe(1)
    expect((await queue.get(job.id))!).toMatchObject({ status: 'succeeded', attempts: 2 })
    expect((await queue.runsOf(job.id)).map((r) => [r.attempt, r.status, r.worker])).toEqual([
      [1, 'expired', 'dead-worker'],
      [2, 'succeeded', 'w-k'],
    ])
  })

  it('serialises agent runs per ticket and holds long jobs back when the budget is short', async () => {
    const t = `ticket-${runId}-a`
    const u = `ticket-${runId}-b`
    const a1 = await queue.enqueue(
      'agent_run',
      { ticketId: t, trigger: 'new_ticket' },
      { dedupeKey: key('a1') },
    )
    const a2 = await queue.enqueue(
      'agent_run',
      { ticketId: t, trigger: 'customer_reply' },
      { dedupeKey: key('a2') },
    )
    const b = await queue.enqueue(
      'agent_run',
      { ticketId: u, trigger: 'new_ticket' },
      { dedupeKey: key('b') },
    )
    const first = await queue.claim({ worker: 'w-ser', types: ['agent_run'] })
    expect(first?.job.id).toBe(a1.job.id)
    const second = await queue.claim({ worker: 'w-ser', types: ['agent_run'] })
    expect(second?.job.id).toBe(b.job.id)
    expect(await queue.claim({ worker: 'w-ser', types: ['agent_run'] })).toBeNull()
    expect((await queue.get(a2.job.id))!.status).toBe('queued')

    // With less budget than the long-job reserve, agent runs are left for the next tick.
    await queue.succeed(first!.job, first!.run, 'w-ser')
    const ran = await runDueJobs({
      db,
      worker: 'w-ser',
      budgetMs: 10_000,
      longJobReserveMs: 100_000,
      types: ['agent_run'],
      notify: notifySpy(),
      log: () => {},
    })
    expect(ran.map((r) => r.id)).not.toContain(a2.job.id)
    expect((await queue.get(a2.job.id))!).toMatchObject({ status: 'queued', attempts: 0 })
  })

  it('prunes old finished jobs', async () => {
    const old = await queue.enqueue('send_system_email', mail, { dedupeKey: key('old') })
    const fresh = await queue.enqueue('send_system_email', mail, { dedupeKey: key('fresh') })
    await db.query(
      `update public.jobs set status = 'succeeded', finished_at = now() - interval '10 days' where id = $1`,
      [old.job.id],
    )
    await db.query(
      `update public.jobs set status = 'succeeded', finished_at = now() where id = $1`,
      [fresh.job.id],
    )
    const n = await queue.prune({ succeededAfterDays: 7, othersAfterDays: 30 })
    expect(n).toBeGreaterThanOrEqual(1)
    expect(await queue.get(old.job.id)).toBeNull()
    expect(await queue.get(fresh.job.id)).not.toBeNull()
  })
})
