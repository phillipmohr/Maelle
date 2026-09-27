/** Recurring schedule from heartbeats: never missed, never doubled. Run with `pnpm test:db`. */
import { describe, expect, it } from 'vitest'
import { claimSlot } from '../../../server/jobs/heartbeats'
import { runSchedule } from '../../../server/jobs/schedule'
import { withRollback } from './_db'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('recurring schedule', () => {
  it('claims a slot exactly once', async () => {
    await withRollback(async (db) => {
      expect(await claimSlot(db, 'fetch_mail', 'A', 60)).toBe(true)
      expect(await claimSlot(db, 'fetch_mail', 'A', 60)).toBe(false)
      expect(await claimSlot(db, 'fetch_mail', 'B', 60)).toBe(true)
      expect(await claimSlot(db, 'wake_snoozed', 'B', 60)).toBe(true)
    })
  })

  it('enqueues every due recurring job once per slot and keeps a single pending instance', async () => {
    await withRollback(async (db) => {
      // 12:00 in Europe/Berlin (seed settings: digest at 08:00), so the digest is due today.
      const t0 = new Date('2026-09-27T10:00:30Z')
      const r1 = await runSchedule(db, { now: t0 })
      expect([...r1.enqueued].sort()).toEqual([
        'daily_digest',
        'fetch_mail',
        'run_due_scheduled',
        'waiting_follow_up',
        'wake_snoozed',
      ])
      const keys = (
        await db.query<{ dedupe_key: string }>(
          `select dedupe_key from public.jobs where type in ('fetch_mail', 'daily_digest') order by dedupe_key`,
        )
      ).map((r) => r.dedupe_key)
      expect(keys).toEqual(['daily_digest:2026-09-27', 'fetch_mail:2026-09-27T10:00Z'])

      const r2 = await runSchedule(db, { now: t0 })
      expect(r2.enqueued).toEqual([])
      expect(r2.skipped.length).toBe(5)

      // A minute later: the previous instances are still pending, so nothing piles up.
      const t1 = new Date(t0.getTime() + 61_000)
      const r3 = await runSchedule(db, { now: t1 })
      expect(r3.enqueued).toEqual([])
      expect((await db.query(`select id from public.jobs where type = 'fetch_mail'`)).length).toBe(
        1,
      )

      // Once the fetch finished, the next minute enqueues a new one (and only that one).
      await db.query(
        `update public.jobs set status = 'succeeded', finished_at = now() where type in ('fetch_mail', 'daily_digest')`,
      )
      const r4 = await runSchedule(db, { now: t1 })
      expect(r4.enqueued).toEqual(['fetch_mail'])
      expect(
        (await db.query(`select id from public.jobs where type = 'daily_digest'`)).length,
      ).toBe(1)

      // Tomorrow at 08:00 Berlin the digest is due again.
      const r5 = await runSchedule(db, {
        now: new Date('2026-09-28T06:00:10Z'),
        only: ['daily_digest'],
      })
      expect(r5.enqueued).toEqual(['daily_digest'])
      const hb = await db.one<{ last_slot: string }>(
        `select last_slot from public.job_heartbeats where job = 'daily_digest'`,
      )
      expect(hb!.last_slot).toBe('2026-09-28')
    })
  })

  it('does not run the digest before digest_time in the app timezone', async () => {
    await withRollback(async (db) => {
      const r = await runSchedule(db, {
        now: new Date('2026-09-27T05:30:00Z'),
        only: ['daily_digest'],
      })
      expect(r.enqueued).toEqual([])
      expect(
        (await db.query(`select id from public.jobs where type = 'daily_digest'`)).length,
      ).toBe(0)
      const late = await runSchedule(db, {
        now: new Date('2026-09-27T06:00:00Z'),
        only: ['daily_digest'],
      })
      expect(late.enqueued).toEqual(['daily_digest'])
    })
  })
})
