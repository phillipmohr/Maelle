/** Snooze wake-up and follow-up timers. Run with `pnpm test:db`. */
import { describe, expect, it } from 'vitest'
import { runWaitingFollowUps, wakeSnoozed } from '../../../server/jobs/timers'
import { insertOutboundMessage, insertTicket, withRollback } from './_db'

const url = process.env.TEST_DATABASE_URL
const now = new Date('2026-09-27T12:00:00Z')
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000)

describe.skipIf(!url)('timers', () => {
  it('wakes snoozed tickets whose snoozed_until passed', async () => {
    await withRollback(async (db) => {
      const due = await insertTicket(db, {
        customer_email: 'due@example.com',
        status: 'snoozed',
        snoozed_until: daysAgo(0.01),
      })
      const later = await insertTicket(db, {
        customer_email: 'later@example.com',
        status: 'snoozed',
        snoozed_until: new Date(now.getTime() + 3_600_000),
      })
      const woken = await wakeSnoozed(db, now)
      expect(woken).toEqual([due])
      const rows = await db.query<{ id: string; status: string; snoozed_until: Date | null }>(
        'select id, status, snoozed_until from public.tickets where id = any ($1::uuid[])',
        [[due, later]],
      )
      expect(rows.find((r) => r.id === due)).toMatchObject({
        status: 'needs_decision',
        snoozed_until: null,
      })
      expect(rows.find((r) => r.id === later)!.status).toBe('snoozed')
      expect(await wakeSnoozed(db, now)).toEqual([])
    })
  })

  it('enqueues one follow_up run after follow_up_days and one auto_close run after auto_close_days', async () => {
    await withRollback(async (db) => {
      const ticket = await insertTicket(db, {
        customer_email: 'wait@example.com',
        status: 'waiting_on_customer',
        first_message_at: daysAgo(10),
        last_customer_message_at: daysAgo(10),
      })
      const waitingSince = daysAgo(4)
      await insertOutboundMessage(db, ticket, {
        message_id: '<ours-1@instaradar.app>',
        to: 'wait@example.com',
        sent_at: waitingSince,
      })
      // An older reply before the customer's last message does not count.
      await insertOutboundMessage(db, ticket, {
        message_id: '<ours-0@instaradar.app>',
        to: 'wait@example.com',
        sent_at: daysAgo(20),
      })

      const first = await runWaitingFollowUps(db, now)
      expect(first).toEqual([{ ticketId: ticket, kind: 'follow_up', jobId: expect.any(String) }])
      const job = await db.one<{ type: string; payload: unknown; dedupe_key: string }>(
        'select type, payload, dedupe_key from public.jobs where id = $1',
        [first[0]!.jobId],
      )
      expect(job).toEqual({
        type: 'agent_run',
        payload: { ticketId: ticket, trigger: 'follow_up' },
        dedupe_key: `agent_run:${ticket}:follow_up:follow_up:${waitingSince.toISOString()}`,
      })
      expect(await runWaitingFollowUps(db, now)).toEqual([])
      expect(await runWaitingFollowUps(db, new Date(now.getTime() + 60_000))).toEqual([])

      const later = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000)
      const second = await runWaitingFollowUps(db, later)
      expect(second).toEqual([{ ticketId: ticket, kind: 'auto_close', jobId: expect.any(String) }])
      expect(await runWaitingFollowUps(db, later)).toEqual([])
      const rows = await db.query<{ kind: string }>(
        'select kind from public.ticket_follow_ups where ticket_id = $1 order by created_at',
        [ticket],
      )
      expect(rows.map((r) => r.kind)).toEqual(['follow_up', 'auto_close'])
      expect(
        (
          await db.query(
            `select id from public.jobs where type = 'agent_run' and payload ->> 'ticketId' = $1`,
            [ticket],
          )
        ).length,
      ).toBe(2)
    })
  })

  it('skips straight to auto_close when both are overdue, and stays quiet while the customer has time', async () => {
    await withRollback(async (db) => {
      const overdue = await insertTicket(db, {
        customer_email: 'overdue@example.com',
        status: 'waiting_on_customer',
        last_customer_message_at: daysAgo(12),
      })
      await insertOutboundMessage(db, overdue, {
        message_id: '<ours-2@instaradar.app>',
        to: 'overdue@example.com',
        sent_at: daysAgo(9),
      })
      const recent = await insertTicket(db, {
        customer_email: 'recent@example.com',
        status: 'waiting_on_customer',
        last_customer_message_at: daysAgo(1),
      })
      await insertOutboundMessage(db, recent, {
        message_id: '<ours-3@instaradar.app>',
        to: 'recent@example.com',
        sent_at: daysAgo(0.5),
      })
      const noReply = await insertTicket(db, {
        customer_email: 'noreply@example.com',
        status: 'waiting_on_customer',
        last_customer_message_at: daysAgo(30),
      })
      const closed = await insertTicket(db, {
        customer_email: 'closed@example.com',
        status: 'closed',
        last_customer_message_at: daysAgo(30),
      })
      await insertOutboundMessage(db, closed, {
        message_id: '<ours-4@instaradar.app>',
        to: 'closed@example.com',
        sent_at: daysAgo(20),
      })

      const runs = await runWaitingFollowUps(db, now)
      expect(runs).toEqual([{ ticketId: overdue, kind: 'auto_close', jobId: expect.any(String) }])
      expect(
        (
          await db.query(
            'select id from public.ticket_follow_ups where ticket_id = any ($1::uuid[])',
            [[recent, noReply, closed]],
          )
        ).length,
      ).toBe(0)
    })
  })
})
