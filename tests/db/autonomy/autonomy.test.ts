/**
 * IRDR-459 database tests: migration, track record against the decisions table, the PUT
 * transaction with its audit rows, evaluate on seeded tickets, the notifications dedupe, the digest
 * data and learning events. Runs with `pnpm test:db` (TEST_DATABASE_URL set by scripts/test-db.ts).
 */
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { currentAppId, resetAppIdCache } from '../../../server/autonomy/app'
import {
  parseActivityQuery,
  queryActivity,
  queryAllActivity,
} from '../../../server/autonomy/activity'
import { loadEvaluateContextFromDb } from '../../../server/autonomy/context'
import { createAutonomyService, decide } from '../../../server/autonomy/evaluate'
import {
  applyAutonomyUpdate,
  buildAutonomyResponse,
  loadSettings,
} from '../../../server/autonomy/repo'
import { loadDigestData } from '../../../server/notify/digest'
import { createDbNotificationLog } from '../../../server/notify/log'
import { renderDigest } from '../../../server/notify/templates'
import {
  findLearningEvent,
  loadLearningContext,
  recordLearningEvent,
} from '../../../server/learning/repo'
import { closeDbForTests } from '../../../server/utils/db'
import { createStubNotify } from '../../../shared/services-stubs'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('IRDR-459 autonomy schema and queries', () => {
  let db: pg.Client
  let appId: string
  const ticketId = async (n: number) =>
    (await db.query<{ id: string }>('select id from public.tickets where display_number = $1', [n]))
      .rows[0]!.id

  beforeAll(async () => {
    db = new pg.Client({ connectionString: url })
    await db.connect()
    resetAppIdCache()
    appId = await currentAppId()
  })
  afterAll(async () => {
    await db?.end()
    await closeDbForTests()
  })

  it('adds settings_audit, notifications and learning_events with RLS and the allow-list policy', async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
         and c.relname in ('settings_audit','notifications','learning_events')`,
    )
    expect(r.rows.map((x) => x.relname).sort()).toEqual([
      'learning_events',
      'notifications',
      'settings_audit',
    ])
    for (const row of r.rows) expect(row.relrowsecurity).toBe(true)
    const policies = await db.query<{ tablename: string }>(
      `select tablename from pg_policies where policyname = 'allowed_user_all' and tablename in ('settings_audit','notifications','learning_events')`,
    )
    expect(policies.rows).toHaveLength(3)
  })

  it('computes the track record from the decisions table', async () => {
    const res = await buildAutonomyResponse(appId)
    const counts = await db.query<{
      case_type: string
      n: number
      rejected: number
      edited: number
    }>(
      `select t.case_type, count(*)::int as n,
              count(*) filter (where d.decision in ('rejected','handled_manually'))::int as rejected,
              count(*) filter (where d.decision = 'approved_with_edits')::int as edited
       from public.decisions d join public.tickets t on t.id = d.ticket_id
       where d.decision not in ('snoozed','marked_done') and t.case_type is not null
       group by t.case_type`,
    )
    expect(counts.rows.length).toBeGreaterThan(3)
    for (const row of counts.rows) {
      const c = res.cases.find((x) => x.caseType === row.case_type)!
      expect(c.total).toBe(Math.min(row.n, 30))
      expect(c.rejected).toBe(row.rejected)
      expect(c.edited).toBe(row.edited)
    }
    const fr = res.cases.find((c) => c.caseType === 'feature_request')!
    expect(fr.mode).toBe('auto')
    expect(fr.recommendation).toMatch(/^On Auto since Sep 12 · 0 undos$/)
    expect(res.onAutoCount).toBe(1)
    expect(res.settings.digestTime).toBe('08:00')
    expect(
      res.locks
        .filter((l) => l.locked)
        .map((l) => l.type)
        .sort(),
    ).toEqual(['cancel_immediately', 'delete_account', 'refund_latest_payment'])
  })

  it('keeps the window at the last 30 decisions', async () => {
    const id = await ticketId(4805) // cancellation_only
    await db.query('begin')
    try {
      for (let i = 0; i < 40; i++) {
        await db.query(
          `insert into public.decisions (ticket_id, decision, decided_at) values ($1, $2, now() - ($3 || ' hours')::interval)`,
          [id, i < 3 ? 'approved_with_edits' : 'approved', String(200 - i)],
        )
      }
      // the three edits are the oldest, so they fall out of the window
      const n = await db.query<{ n: number }>(
        `with ranked as (select d.decision, row_number() over (order by d.decided_at desc) rn
           from public.decisions d join public.tickets t on t.id = d.ticket_id where t.case_type = 'cancellation_only'
           and d.decision not in ('snoozed','marked_done'))
         select count(*)::int as n from ranked where rn <= 30 and decision = 'approved_with_edits'`,
      )
      expect(n.rows[0]!.n).toBe(0)
    } finally {
      await db.query('rollback')
    }
    const res = await buildAutonomyResponse(appId)
    const c = res.cases.find((x) => x.caseType === 'cancellation_only')!
    expect(c.total).toBeLessThanOrEqual(30)
  })

  it('applies modes, locks and settings and writes one audit row per change', async () => {
    const before = await db.query<{ n: number }>(
      'select count(*)::int as n from public.settings_audit',
    )
    const changes = await applyAutonomyUpdate(
      appId,
      {
        modes: { cancellation_only: 'auto', feature_request: 'auto' },
        locks: { refund_latest_payment: false, cancel_at_period_end: false },
        settings: { followUpDays: 5, globalPause: false, notifyEmail: 'phillip@example.com' },
      },
      'test@maelle.local',
    )
    // feature_request was already auto, cancel_at_period_end already unlocked, globalPause already false
    expect(changes.map((c) => c.summary).sort()).toEqual(
      [
        'Cancellation only: Always ask → Auto',
        'Refund latest payment: unlocked for Auto',
        'Follow-up after: 3 days → 5 days',
        'Notify email: not set → phillip@example.com',
      ].sort(),
    )
    expect(changes.every((c) => c.changedBy === 'test@maelle.local')).toBe(true)
    const after = await db.query<{ n: number }>(
      'select count(*)::int as n from public.settings_audit',
    )
    expect(after.rows[0]!.n - before.rows[0]!.n).toBe(4)
    const res = await buildAutonomyResponse(appId)
    expect(res.settings.followUpDays).toBe(5)
    expect(res.settings.undoWindowMinutes).toBe(10) // untouched: the foundation test asserts it
    expect(res.settings.notifyEmail).toBe('phillip@example.com')
    expect(res.cases.find((c) => c.caseType === 'cancellation_only')!.mode).toBe('auto')
    expect(res.cases.find((c) => c.caseType === 'cancellation_only')!.autoSince).toBeTruthy()
    expect(res.locks.find((l) => l.type === 'refund_latest_payment')!.locked).toBe(false)
    expect(res.onAutoCount).toBe(2)
  })

  it('evaluates seeded tickets with the database context', async () => {
    // #4824 Tom Becker: cancellation_only, now on Auto, no risk, all reversible → auto
    expect(decide(await loadEvaluateContextFromDb(await ticketId(4824))).verdict).toBe('auto')
    // #4825 chargeback, high risk → ask, and the alert goes out once
    const notify = createStubNotify()
    const svc = createAutonomyService({
      loadContext: loadEvaluateContextFromDb,
      notify: () => notify,
      siteUrl: () => 'http://localhost:3000',
      log: () => {},
    })
    expect(await svc.evaluateDetailed(await ticketId(4825))).toMatchObject({
      verdict: 'ask',
      reason: 'high_risk',
    })
    expect(notify.calls).toHaveLength(1)
    expect(notify.calls[0]!.payload).toMatchObject({
      displayNumber: 4825,
      riskLevel: 'high',
      caseType: 'chargeback',
    })
    // #4822 refund stage 1: even on Auto the customer must confirm first
    await applyAutonomyUpdate(appId, { modes: { refund_request: 'auto' } }, 'test@maelle.local')
    expect(decide(await loadEvaluateContextFromDb(await ticketId(4822))).reason).toBe(
      'confirmation_pending',
    )
    // #4809 refund stage 2: cancel_immediately is still locked → ask
    expect(decide(await loadEvaluateContextFromDb(await ticketId(4809))).reason).toBe(
      'locked_action',
    )
    // Pause all stops everything
    await applyAutonomyUpdate(appId, { settings: { globalPause: true } }, 'test@maelle.local')
    expect(decide(await loadEvaluateContextFromDb(await ticketId(4824))).reason).toBe('paused')
    await applyAutonomyUpdate(
      appId,
      { settings: { globalPause: false }, modes: { refund_request: 'always_ask' } },
      'test@maelle.local',
    )
    // display numbers work as ids too
    expect(decide(await loadEvaluateContextFromDb('4824')).verdict).toBe('auto')
    expect(
      decide(await loadEvaluateContextFromDb('00000000-0000-4000-8000-000000000000')).reason,
    ).toBe('not_found')
  })

  it('dedupes notifications per kind and key', async () => {
    const log = createDbNotificationLog(async () => appId)
    const key = `test:${Date.now()}`
    const first = await log.claim({
      kind: 'high_risk_ticket',
      dedupeKey: key,
      ticketId: await ticketId(4825),
    })
    expect(first).not.toBeNull()
    expect(await log.claim({ kind: 'high_risk_ticket', dedupeKey: key })).toBeNull() // pending blocks
    await log.finish(first!.id, {
      status: 'sent',
      recipient: 'p@example.com',
      subject: 's',
      body: 'b',
    })
    expect(await log.claim({ kind: 'high_risk_ticket', dedupeKey: key })).toBeNull() // sent blocks
    const failedKey = `${key}:failed`
    const f = await log.claim({ kind: 'system_alert', dedupeKey: failedKey })
    await log.finish(f!.id, {
      status: 'failed',
      recipient: 'p@example.com',
      subject: 's',
      body: 'b',
      error: 'x',
    })
    expect(await log.claim({ kind: 'system_alert', dedupeKey: failedKey })).not.toBeNull() // failed can retry
    expect(await log.claim({ kind: 'system_alert', dedupeKey: null })).not.toBeNull()
    expect(await log.lastSentAt('high_risk_ticket')).toBeTruthy()
  })

  it('builds the digest from the seed', async () => {
    const settings = await loadSettings(appId)
    const data = await loadDigestData(appId, {
      since: new Date(Date.now() - 3 * 24 * 3_600_000).toISOString(),
      now: new Date(),
      timezone: settings.timezone,
      siteUrl: 'http://localhost:3000',
    })
    expect(data.autoHandled.map((t) => t.displayNumber).sort()).toEqual([4816, 4818])
    expect(data.autoHandled[0]!.ran).toContain('send_reply')
    expect(data.needsDecision[0]!.displayNumber).toBe(4825) // high risk first
    expect(data.needsDecision.map((t) => t.displayNumber)).toContain(4820) // action failed
    expect(data.waiting.map((t) => t.displayNumber)).toContain(4801) // snoozed
    expect(data.failures.map((f) => f.displayNumber).sort()).toEqual([4812, 4820])
    const mail = renderDigest(data)
    expect(mail.body).toContain('#4818 Liam Chen')
    expect(mail.body).not.toMatch(/[—―]/)
  })

  it('lists executions with settings entries and paginates by cursor', async () => {
    const page = await queryActivity(appId, parseActivityQuery({ limit: '10' }))
    expect(page.items).toHaveLength(10)
    expect(page.nextCursor).toBeTruthy()
    expect(page.settings.length).toBeGreaterThan(0) // written by the PUT test above
    const second = await queryActivity(
      appId,
      parseActivityQuery({ limit: '10', cursor: page.nextCursor }),
    )
    expect(second.items.every((i) => !page.items.some((p) => p.id === i.id))).toBe(true)
    expect(second.items[0]!.createdAt <= page.items.at(-1)!.createdAt).toBe(true)
    const auto = await queryActivity(appId, parseActivityQuery({ by: 'auto' }))
    expect(auto.items.length).toBeGreaterThan(0)
    expect(auto.items.every((i) => i.executedBy === 'auto')).toBe(true)
    expect(auto.settings).toEqual([])
    const irr = await queryActivity(appId, parseActivityQuery({ irreversibleOnly: 'true' }))
    expect(irr.items.every((i) => i.irreversible)).toBe(true)
    const all = await queryAllActivity(appId, parseActivityQuery({}))
    const total = await db.query<{ n: number }>(
      'select count(*)::int as n from public.action_executions',
    )
    expect(all.items).toHaveLength(total.rows[0]!.n)
  })

  it('loads the learning context and records events once', async () => {
    const ctx = await loadLearningContext('4815')
    expect(ctx).not.toBeNull()
    expect(ctx!.ticket.caseType).toBe('cancellation_reason_ask')
    expect(ctx!.customerMessage).toMatch(/^Hallo/)
    expect(ctx!.replySource).toBe('sent')
    expect(ctx!.reply).toMatch(/^Hi Hannah/)
    expect(ctx!.templateNotionPageId).toBe('3e8c931f6ae58147b800e658bf20d6d7')
    const open = await loadLearningContext('4824')
    expect(open!.replySource).toBe('draft') // approved draft, nothing sent yet
    await recordLearningEvent(
      ctx!.ticket.id,
      'example',
      { id: 'page-1', url: 'https://app.notion.com/p/page-1' },
      'test@maelle.local',
    )
    await recordLearningEvent(
      ctx!.ticket.id,
      'example',
      { id: 'page-2', url: 'https://app.notion.com/p/page-2' },
      'test@maelle.local',
    )
    expect(await findLearningEvent(ctx!.ticket.id, 'example')).toMatchObject({
      notionPageId: 'page-1',
      existing: true,
    })
    expect(await findLearningEvent(ctx!.ticket.id, 'kb_draft')).toBeNull()
  })
})
