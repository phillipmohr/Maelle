/**
 * Database tests. Run with `pnpm test:db` (starts a local Postgres, applies shim + migrations, seeds).
 * Skipped when TEST_DATABASE_URL is not set.
 */
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('foundation schema', () => {
  let db: pg.Client

  beforeAll(async () => {
    db = new pg.Client({ connectionString: url })
    await db.connect()
  })
  afterAll(async () => {
    await db?.end()
  })

  it('has every binding table with RLS enabled', async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname`,
    )
    const names = r.rows.map((x) => x.relname)
    for (const t of [
      'apps',
      'tickets',
      'messages',
      'agent_runs',
      'proposals',
      'proposed_actions',
      'action_executions',
      'decisions',
      'release_notifications',
      'cancellation_reasons',
      'settings',
      'autonomy_modes',
      'action_locks',
    ]) {
      expect(names).toContain(t)
    }
    for (const row of r.rows) expect(row.relrowsecurity).toBe(true)
  })

  it('lets only the allowed user read through RLS', async () => {
    await db.query('begin')
    try {
      await db.query('set local role authenticated')
      await db.query(
        `select set_config('request.jwt.claims', '{"email":"someone@else.com","role":"authenticated"}', true)`,
      )
      const denied = await db.query('select count(*)::int as n from public.tickets')
      expect(denied.rows[0].n).toBe(0)
      await db.query(
        `select set_config('request.jwt.claims', '{"email":"test@maelle.local","role":"authenticated"}', true)`,
      )
      const allowed = await db.query('select count(*)::int as n from public.tickets')
      expect(allowed.rows[0].n).toBeGreaterThan(0)
    } finally {
      await db.query('rollback')
    }
  })

  it('blocks sign-ups that are not on the allow-list', async () => {
    await db.query('begin')
    try {
      await expect(
        db.query(`insert into auth.users (email) values ('intruder@example.com')`),
      ).rejects.toThrow(/not allowed/)
    } finally {
      await db.query('rollback')
    }
    await db.query('begin')
    try {
      await db.query(`insert into auth.users (email) values ('test@maelle.local')`)
    } finally {
      await db.query('rollback')
    }
  })

  it('enforces status, risk and stage constraints', async () => {
    const app = await db.query<{ id: string }>('select id from public.apps limit 1')
    await db.query('begin')
    try {
      await expect(
        db.query(
          `insert into public.tickets (app_id, customer_email, status) values ($1, 'x@y.z', 'bogus')`,
          [app.rows[0].id],
        ),
      ).rejects.toThrow(/check constraint/)
    } finally {
      await db.query('rollback')
    }
    await db.query('begin')
    try {
      await expect(
        db.query(
          `insert into public.tickets (app_id, customer_email, risk_level) values ($1, 'x@y.z', 'medium')`,
          [app.rows[0].id],
        ),
      ).rejects.toThrow(/check constraint/)
    } finally {
      await db.query('rollback')
    }
  })

  it('seeded the design tickets and the audit log', async () => {
    const t = await db.query<{ n: number }>('select count(*)::int as n from public.tickets')
    expect(t.rows[0].n).toBe(18)
    const ex = await db.query<{ status: string; n: number }>(
      `select status, count(*)::int as n from public.action_executions group by status order by status`,
    )
    const byStatus = Object.fromEntries(ex.rows.map((r) => [r.status, r.n]))
    expect(byStatus.failed).toBe(2)
    expect(byStatus.held).toBe(1)
    expect(byStatus.succeeded).toBeGreaterThan(20)
    const settings = await db.query(
      'select undo_window_minutes, digest_time::text from public.settings',
    )
    expect(settings.rows[0].undo_window_minutes).toBe(10)
  })

  it('assigns the next display number after the seed', async () => {
    const app = await db.query<{ id: string }>('select id from public.apps limit 1')
    await db.query('begin')
    try {
      const r = await db.query<{ display_number: number }>(
        `insert into public.tickets (app_id, customer_email) values ($1, 'new@customer.com') returning display_number`,
        [app.rows[0].id],
      )
      expect(r.rows[0].display_number).toBeGreaterThan(4828)
    } finally {
      await db.query('rollback')
    }
  })
})
