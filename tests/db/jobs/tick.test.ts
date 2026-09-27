/** The two cron lanes end to end against the schema. Run with `pnpm test:db`. */
import { describe, expect, it } from 'vitest'
import { registerTimerJobHandlers } from '../../../server/jobs/handlers'
import { getHeartbeat } from '../../../server/jobs/heartbeats'
import { resetJobHandlersForTests } from '../../../server/jobs/registry'
import { createJobsService } from '../../../server/jobs/service'
import { runFetchMailLane, runTick } from '../../../server/jobs/tick'
import { registerMailJobHandlers } from '../../../server/mail/service'
import { readFixture } from '../../fixtures/mail'
import { makeMailContext, notifySpy, withRollback } from './_db'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('cron lanes', () => {
  it('a tick schedules the recurring jobs, runs those with handlers and defers the rest', async () => {
    await withRollback(async (db) => {
      resetJobHandlersForTests()
      const ctx = makeMailContext(db)
      const jobs = createJobsService({ db })
      registerMailJobHandlers(jobs, ctx)
      registerTimerJobHandlers(jobs, db)
      const notify = notifySpy()
      const now = new Date('2026-09-27T10:00:30Z')

      const res = await runTick({
        db,
        now,
        budgetMs: 20_000,
        worker: 'tick-test',
        notify,
        log: () => {},
      })
      expect(res).toMatchObject({ ok: true, job: 'tick', ran: 5, alerts: [] })
      expect([...res.scheduled].sort()).toEqual([
        'daily_digest',
        'fetch_mail',
        'run_due_scheduled',
        'waiting_follow_up',
        'wake_snoozed',
      ])
      const outcomes = Object.fromEntries(res.jobs.map((j) => [j.type, j.outcome]))
      expect(outcomes).toEqual({
        fetch_mail: 'succeeded',
        wake_snoozed: 'succeeded',
        waiting_follow_up: 'succeeded',
        run_due_scheduled: 'skipped',
        daily_digest: 'skipped',
      })
      expect((await getHeartbeat(db, 'fetch_mail'))!.last_succeeded_at).toBeInstanceOf(Date)
      expect((await getHeartbeat(db, 'run_due_scheduled'))!.last_started_at).toBeNull()
      expect(
        await db.one(
          `select cursor from public.mail_cursors where mailbox = 'support@instaradar.app'`,
        ),
      ).toEqual({ cursor: '0' })
      expect(notify.calls).toEqual([])

      // Same minute again: nothing is doubled, the deferred jobs wait for their delay.
      const again = await runTick({
        db,
        now,
        budgetMs: 20_000,
        worker: 'tick-test-2',
        notify,
        log: () => {},
      })
      expect(again).toMatchObject({ scheduled: [], ran: 0 })
    })
  })

  it('the fetch-mail lane only fetches mail', async () => {
    await withRollback(async (db) => {
      resetJobHandlersForTests()
      const ctx = makeMailContext(db)
      const jobs = createJobsService({ db })
      registerMailJobHandlers(jobs, ctx)
      registerTimerJobHandlers(jobs, db)
      ctx.provider.inject(readFixture('french'))
      const res = await runFetchMailLane({
        db,
        now: new Date('2026-09-27T10:01:00Z'),
        budgetMs: 10_000,
        worker: 'lane',
        notify: notifySpy(),
        log: () => {},
      })
      expect(res).toMatchObject({ ok: true, job: 'fetch_mail', ran: 1, scheduled: ['fetch_mail'] })
      expect(res.jobs[0]).toMatchObject({ type: 'fetch_mail', outcome: 'succeeded' })
      expect(res.fetch).toMatchObject({ fetched: 1, ingested: 1, ticketsCreated: 1 })
      expect(
        (
          await db.query(
            `select id from public.tickets where customer_email = 'elodie.martin@example.fr'`,
          )
        ).length,
      ).toBe(1)
      expect(
        (
          await db.query(
            `select type from public.jobs where type <> 'fetch_mail' and type <> 'agent_run'`,
          )
        ).length,
      ).toBe(0)
    })
  })
})
