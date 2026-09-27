/** Heartbeats and health alerts. Run with `pnpm test:db`. */
import { describe, expect, it } from 'vitest'
import { checkHealth } from '../../../server/jobs/health'
import { getHeartbeat, recordSuccess } from '../../../server/jobs/heartbeats'
import { JobQueue } from '../../../server/jobs/queue'
import { handlerRegistry, resetJobHandlersForTests } from '../../../server/jobs/registry'
import { runDueJobs } from '../../../server/jobs/runner'
import { notifySpy, withRollback } from './_db'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('health', () => {
  it('alerts after three consecutive fetch_mail failures and resets on success', async () => {
    await withRollback(async (db) => {
      resetJobHandlersForTests()
      let fail = true
      handlerRegistry().set('fetch_mail', async () => {
        if (fail) throw new Error('imap down')
      })
      const notify = notifySpy()
      const queue = new JobQueue(db)
      const run = async (i: number) => {
        await queue.enqueue(
          'fetch_mail',
          {},
          { dedupeKey: `test:health:${i}`, runAt: new Date(Date.now() - 1000) },
        )
        return runDueJobs({
          db,
          worker: 'w-h',
          budgetMs: 10_000,
          types: ['fetch_mail'],
          notify,
          log: () => {},
        })
      }
      const r1 = await run(1)
      expect(r1[0]).toMatchObject({ outcome: 'failed', attempt: 1 })
      await run(2)
      expect(notify.calls).toHaveLength(0)
      await run(3)
      expect(notify.calls).toHaveLength(1)
      expect((notify.calls[0]!.payload as { title: string; detail: string }).title).toBe(
        'fetch_mail failed 3 times in a row',
      )
      expect((notify.calls[0]!.payload as { detail: string }).detail).toContain('imap down')
      let hb = (await getHeartbeat(db, 'fetch_mail'))!
      expect(hb.consecutive_failures).toBe(3)
      expect(hb.last_error).toContain('imap down')
      expect(hb.last_started_at).toBeInstanceOf(Date)
      // Recurring failures are terminal for that instance (the schedule fires the next one), never dead-lettered.
      const statuses = await db.query<{ status: string }>(
        `select status from public.jobs where type = 'fetch_mail'`,
      )
      expect(statuses.map((s) => s.status)).toEqual(['failed', 'failed', 'failed'])

      fail = false
      await run(4)
      hb = (await getHeartbeat(db, 'fetch_mail'))!
      expect(hb.consecutive_failures).toBe(0)
      expect(hb.last_succeeded_at).toBeInstanceOf(Date)
      expect(notify.calls).toHaveLength(1)
    })
  })

  it('alerts once per hour when fetch_mail has not succeeded for 15 minutes', async () => {
    await withRollback(async (db) => {
      const notify = notifySpy()
      const now = new Date('2026-09-27T12:00:00Z')
      await recordSuccess(db, 'fetch_mail', new Date(now.getTime() - 14 * 60_000))
      expect(await checkHealth(db, { now, notify })).toEqual([])
      await recordSuccess(db, 'fetch_mail', new Date(now.getTime() - 16 * 60_000))
      expect(await checkHealth(db, { now, notify })).toEqual(['fetch_mail'])
      expect((notify.calls[0]!.payload as { title: string }).title).toBe(
        'fetch_mail has not succeeded for 16 minutes',
      )
      expect(await checkHealth(db, { now: new Date(now.getTime() + 10 * 60_000), notify })).toEqual(
        [],
      )
      expect(await checkHealth(db, { now: new Date(now.getTime() + 61 * 60_000), notify })).toEqual(
        ['fetch_mail'],
      )
      expect(notify.calls).toHaveLength(2)

      // A heartbeat that never succeeded counts from its creation.
      await db.query(
        `update public.job_heartbeats set last_succeeded_at = null, last_alert_at = null, created_at = $1 where job = 'fetch_mail'`,
        [new Date(now.getTime() - 20 * 60_000)],
      )
      expect(await checkHealth(db, { now, notify })).toEqual(['fetch_mail'])
    })
  })
})
