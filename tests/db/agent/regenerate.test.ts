/**
 * Bulk regenerate (pnpm test:db): which tickets count as an unsent draft. Runs the route's SQL inside
 * a rolled-back transaction, so the shared seeded database stays untouched.
 */
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { REGENERABLE_DRAFTS_SQL } from '../../../server/agent/regenerate'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('regenerable drafts', () => {
  let db: pg.Client

  beforeAll(async () => {
    db = new pg.Client({ connectionString: url })
    await db.connect()
  })
  afterAll(async () => {
    await db?.end()
  })

  async function inTx(fn: () => Promise<void>) {
    await db.query('begin')
    try {
      await fn()
    } finally {
      await db.query('rollback')
    }
  }
  const ids = async () =>
    (await db.query<{ id: string }>(REGENERABLE_DRAFTS_SQL)).rows.map((r) => r.id)

  it('lists needs_decision tickets whose active proposal has a reply, nothing else', async () => {
    const expected = await db.query<{ id: string }>(
      `select t.id from public.tickets t
       join public.proposals p on p.ticket_id = t.id and p.status = 'active'
       where t.status = 'needs_decision' and p.reply_draft is not null`,
    )
    expect(expected.rows.length).toBeGreaterThan(0)
    expect((await ids()).sort()).toEqual(expected.rows.map((r) => r.id).sort())

    const others = await db.query<{ id: string }>(
      `select id from public.tickets where status <> 'needs_decision'`,
    )
    const listed = new Set(await ids())
    for (const o of others.rows) expect(listed.has(o.id)).toBe(false)
  })

  it('skips tickets with an agent run queued or running, a snoozed ticket and a proposal without reply', async () => {
    await inTx(async () => {
      const [a, b, c, d] = await ids()
      expect(d).toBeDefined()
      await db.query(
        `insert into public.jobs (type, payload, status) values
           ('agent_run', jsonb_build_object('ticketId', $1::text, 'trigger', 'rerun'), 'queued'),
           ('agent_run', jsonb_build_object('ticketId', $2::text, 'trigger', 'rerun'), 'running'),
           ('agent_run', jsonb_build_object('ticketId', $3::text, 'trigger', 'rerun'), 'succeeded')`,
        [a, b, c],
      )
      await db.query(
        `update public.tickets set status = 'snoozed', snoozed_until = now() + interval '1 day' where id = $1`,
        [d],
      )
      const after = await ids()
      expect(after).not.toContain(a)
      expect(after).not.toContain(b)
      expect(after).toContain(c) // a finished run does not block a new one
      expect(after).not.toContain(d)

      await db.query(
        `update public.proposals set reply_draft = null where ticket_id = $1 and status = 'active'`,
        [c],
      )
      expect(await ids()).not.toContain(c)
    })
  })
})
