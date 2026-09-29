/** Mailbox history import and the classify-only pass against the real schema. Run with `pnpm test:db`. */
import { describe, expect, it } from 'vitest'
import { runBackfillChunk, startBackfill } from '../../../server/mail/backfill'
import {
  classifyProgress,
  createFakeClassifier,
  runClassifyChunk,
  scheduleImportedClassification,
} from '../../../server/mail/history-classify'
import { fetchMail } from '../../../server/mail/inbound'
import { registerMailJobHandlers } from '../../../server/mail/service'
import { mailStatus } from '../../../server/mail/status'
import { registerTimerJobHandlers } from '../../../server/jobs/handlers'
import { resetJobHandlersForTests } from '../../../server/jobs/registry'
import { createJobsService } from '../../../server/jobs/service'
import { runFetchMailLane, runTick } from '../../../server/jobs/tick'
import type { Db } from '../../../server/jobs/db'
import { buildEml, readFixture } from '../../fixtures/mail'
import { makeMailContext, notifySpy, withRollback, type TestMailContext } from '../jobs/_db'

const url = process.env.TEST_DATABASE_URL

const SUPPORT = 'InstaRadar Support <support@instaradar.app>'

/** Six months of a small mailbox: three customers, our replies, the usual noise. */
function fillMailbox(ctx: TestMailContext) {
  const p = ctx.provider
  p.inject(
    buildEml({
      from: 'Tom Becker <tom.becker@example.com>',
      subject: 'Please cancel my subscription',
      messageId: '<h1@mail.example.com>',
      date: new Date('2026-03-01T09:00:00Z'),
      text: 'Hi, please cancel my subscription.',
    }),
  )
  p.inject(
    buildEml({
      from: 'Anna Lund <anna@example.se>',
      subject: 'Feature idea: export CSV',
      messageId: '<h2@mail.example.com>',
      date: new Date('2026-03-05T10:00:00Z'),
      text: 'It would be great to export the follower list as CSV.',
    }),
  )
  p.inject(
    buildEml({
      from: 'Tom Becker <tom.becker@example.com>',
      subject: 'Re: Please cancel my subscription',
      messageId: '<h3@mail.example.com>',
      inReplyTo: '<s1@instaradar.app>',
      references: ['<h1@mail.example.com>', '<s1@instaradar.app>'],
      date: new Date('2026-03-03T08:00:00Z'),
      text: 'Thanks, all good.',
    }),
  )
  p.inject(readFixture('bounce'))
  p.inject(readFixture('auto-reply'))
  p.inject(
    buildEml({
      from: 'Anna Lund <anna@example.se>',
      subject: 'Bug: follower count is wrong',
      messageId: '<h5@mail.example.com>',
      date: new Date('2026-06-01T12:00:00Z'),
      text: 'The count shows 120 but Instagram says 118.',
    }),
  )
  // Sent folder: our reply to Tom (headers), our reply to Anna (subject only), an outreach nobody
  // answered, and a forward to ourselves.
  p.injectSent(
    buildEml({
      from: SUPPORT,
      to: 'tom.becker@example.com',
      subject: 'Re: Please cancel my subscription',
      messageId: '<s1@instaradar.app>',
      inReplyTo: '<h1@mail.example.com>',
      references: ['<h1@mail.example.com>'],
      date: new Date('2026-03-02T11:00:00Z'),
      text: 'Done, your subscription ends at the period end.',
    }),
    { messageId: '<s1@instaradar.app>' },
  )
  p.injectSent(
    buildEml({
      from: SUPPORT,
      to: 'anna@example.se',
      subject: 'Re: Feature idea: export CSV',
      messageId: '<s2@instaradar.app>',
      date: new Date('2026-03-06T09:30:00Z'),
      text: 'Thanks for the idea, it is on our list.',
    }),
    { messageId: '<s2@instaradar.app>' },
  )
  p.injectSent(
    buildEml({
      from: SUPPORT,
      to: 'bob@example.org',
      subject: 'Your account',
      messageId: '<s3@instaradar.app>',
      date: new Date('2026-04-01T09:00:00Z'),
      text: 'We noticed a failed payment.',
    }),
    { messageId: '<s3@instaradar.app>' },
  )
  p.injectSent(
    buildEml({
      from: SUPPORT,
      to: 'support@instaradar.app',
      subject: 'Fwd: note to self',
      messageId: '<s4@instaradar.app>',
      date: new Date('2026-04-02T09:00:00Z'),
      text: 'remember this',
    }),
    { messageId: '<s4@instaradar.app>' },
  )
}

interface TicketRow {
  id: string
  status: string
  subject: string | null
  customer_email: string
  case_type: string | null
  case_confidence: number | null
  risk_level: string
  imported_at: Date | null
  first_message_at: Date | null
  last_message_at: Date | null
  closed_at: Date | null
  resolution: string | null
}

async function importedCounts(db: Db) {
  const row = await db.one<{ tickets: number; messages: number }>(
    `select (select count(*)::int from public.tickets where imported_at is not null) as tickets,
            (select count(*)::int from public.messages m join public.tickets t on t.id = m.ticket_id
              where t.imported_at is not null) as messages`,
  )
  return row!
}

/**
 * Runs chunks directly (the lanes do this in production) until nothing is left, then drops the
 * chunk job the start enqueued, which the lanes would have consumed.
 */
async function runUntilDone(ctx: TestMailContext, opts: { limit: number; budgetMs?: number }) {
  for (let i = 0; i < 60; i++) {
    const r = await runBackfillChunk(ctx, opts)
    if (r.done) {
      await ctx.db.query(`delete from public.jobs where type = 'backfill_mail'`)
      return { calls: i + 1, last: r }
    }
  }
  throw new Error('import did not finish')
}

/** Production state when the import starts: the live cursor already sits at the end of INBOX. */
async function liveCursorAtEnd(ctx: TestMailContext) {
  await ctx.db.query(
    `insert into public.mail_cursors (mailbox, provider, cursor) values ($1, 'fake', $2)
     on conflict (mailbox) do update set provider = excluded.provider, cursor = excluded.cursor`,
    [ctx.config.mailbox, String(ctx.provider.inbox.length)],
  )
}

describe.skipIf(!url)('mailbox history import', () => {
  it('imports both folders as closed tickets in date order, threads our old replies, never runs the agent', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      fillMailbox(ctx)
      expect(await startBackfill(ctx)).toEqual({ started: true })
      // Running: a second start is a no-op.
      expect(await startBackfill(ctx)).toEqual({ started: false })

      const { last } = await runUntilDone(ctx, { limit: 50 })
      expect(last.finishedNow).toBe(true)

      // The test database also holds the design's seed tickets; only the imported ones are ours.
      const tickets = await db.query<TicketRow>(
        `select * from public.tickets where imported_at is not null order by first_message_at asc`,
      )
      expect(tickets.map((t) => [t.customer_email, t.subject, t.status])).toEqual([
        ['tom.becker@example.com', 'Please cancel my subscription', 'closed'],
        ['anna@example.se', 'Feature idea: export CSV', 'closed'],
        ['bob@example.org', 'Your account', 'closed'],
        ['anna@example.se', 'Bug: follower count is wrong', 'closed'],
      ])
      for (const t of tickets) {
        expect(t.imported_at).toBeInstanceOf(Date)
        expect(t.resolution).toBeNull()
        expect(t.closed_at).toBeInstanceOf(Date)
      }
      const tom = tickets[0]!
      expect(tom.first_message_at?.toISOString()).toBe('2026-03-01T09:00:00.000Z')
      expect(tom.last_message_at?.toISOString()).toBe('2026-03-03T08:00:00.000Z')
      expect(tom.closed_at?.toISOString()).toBe('2026-03-03T08:00:00.000Z')
      const thread = await db.query<{
        direction: string
        message_id: string
        sent_by: string | null
      }>(
        `select direction, message_id, sent_by from public.messages where ticket_id = $1 order by created_at`,
        [tom.id],
      )
      expect(thread).toEqual([
        { direction: 'in', message_id: '<h1@mail.example.com>', sent_by: null },
        { direction: 'out', message_id: '<s1@instaradar.app>', sent_by: 'you' },
        { direction: 'in', message_id: '<h3@mail.example.com>', sent_by: null },
      ])
      const anna = await db.query<{ direction: string }>(
        `select direction from public.messages where ticket_id = $1 order by created_at`,
        [tickets[1]!.id],
      )
      expect(anna.map((m) => m.direction)).toEqual(['in', 'out'])
      const bob = await db.query<{ direction: string; to_emails: string[] }>(
        `select direction, to_emails from public.messages where ticket_id = $1`,
        [tickets[2]!.id],
      )
      expect(bob).toEqual([{ direction: 'out', to_emails: ['bob@example.org'] }])

      const ignored = await db.query<{ reason: string }>(
        `select reason from public.mail_ignored order by created_at`,
      )
      expect(ignored.map((r) => r.reason.split(':')[0]).sort()).toEqual([
        'auto_reply',
        'bounce',
        'own',
      ])
      expect((await db.query(`select id from public.jobs where type = 'agent_run'`)).length).toBe(0)

      const rows = await db.query<Record<string, unknown>>(
        `select folder, status, listed, imported, skipped, ignored, failed, tickets_created, last_uid::int as last_uid, max_uid::int as max_uid
         from public.mail_backfills order by folder`,
      )
      expect(rows).toEqual([
        {
          folder: 'inbox',
          status: 'done',
          listed: 6,
          imported: 4,
          skipped: 0,
          ignored: 2,
          failed: 0,
          tickets_created: 3,
          last_uid: 6,
          max_uid: 6,
        },
        {
          folder: 'sent',
          status: 'done',
          listed: 4,
          imported: 3,
          skipped: 0,
          ignored: 1,
          failed: 0,
          tickets_created: 1,
          last_uid: 4,
          max_uid: 4,
        },
      ])

      // Running it again changes nothing: everything is already known.
      expect(await startBackfill(ctx)).toEqual({ started: true })
      await runUntilDone(ctx, { limit: 50 })
      expect(await importedCounts(db)).toEqual({ tickets: 4, messages: 7 })
      const again = await db.one<{ skipped: number; imported: number }>(
        `select skipped, imported from public.mail_backfills where folder = 'inbox'`,
      )
      // Six: the four imported mails and the two ignored ones are all known now.
      expect(again).toEqual({ skipped: 6, imported: 0 })

      // A customer writing again to an imported thread reopens it the normal way.
      ctx.provider.inject(
        buildEml({
          from: 'Tom Becker <tom.becker@example.com>',
          subject: 'Re: Please cancel my subscription',
          messageId: '<live1@mail.example.com>',
          inReplyTo: '<h1@mail.example.com>',
          date: new Date('2026-09-27T19:00:00Z'),
          text: 'One more thing: was I charged again?',
        }),
      )
      await fetchMail(ctx)
      const reopened = await db.one<TicketRow>('select * from public.tickets where id = $1', [
        tom.id,
      ])
      expect(reopened!.status).toBe('researching')
      expect(reopened!.closed_at).toBeNull()
      expect(
        await db.query(`select payload from public.jobs where type = 'agent_run'`),
      ).toHaveLength(1)
    })
  })

  it('moves the cursor per handled message inside a chunk budget and resumes where it stopped', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      fillMailbox(ctx)
      await startBackfill(ctx)
      const first = await runBackfillChunk(ctx, { limit: 2, budgetMs: 1 })
      expect(first.done).toBe(false)
      expect(first.listed).toBeGreaterThanOrEqual(1)
      const inbox = await db.one<{ last_uid: number; status: string }>(
        `select last_uid::int as last_uid, status from public.mail_backfills where folder = 'inbox'`,
      )
      expect(inbox!.status).toBe('running')
      expect(inbox!.last_uid).toBe(first.listed)
      const { calls } = await runUntilDone(ctx, { limit: 2, budgetMs: 1 })
      expect(calls).toBeGreaterThan(3)
      expect(await importedCounts(db)).toEqual({ tickets: 4, messages: 7 })
    })
  })

  it('classifies imported tickets afterwards, gives up on a ticket after three failures, reports progress', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      const classifier = createFakeClassifier((input) => {
        if (input.customerEmail === 'bob@example.org') throw new Error('model down')
        const s = (input.subject ?? '').toLowerCase()
        if (s.includes('cancel'))
          return { caseType: 'cancellation_only', confidence: 0.9, rationale: 'r' }
        if (s.includes('feature'))
          return { caseType: 'feature_request', confidence: 0.55, rationale: 'r' }
        return { caseType: 'bug_report', confidence: 0.95, rationale: 'r' }
      })
      ctx.classifier = classifier
      fillMailbox(ctx)
      await startBackfill(ctx)
      await runUntilDone(ctx, { limit: 50 })

      expect(await classifyProgress(db)).toMatchObject({
        imported: 4,
        classified: 0,
        pending: 4,
        failed: 0,
        active: false,
      })
      expect(await scheduleImportedClassification(ctx)).toEqual({ started: true, reason: null })
      expect(await scheduleImportedClassification(ctx)).toMatchObject({ started: false })

      let r = await runClassifyChunk(ctx, { limit: 10 })
      expect(r).toMatchObject({ classified: 3, failed: 1, remaining: 1, done: false })
      r = await runClassifyChunk(ctx, { limit: 10 })
      expect(r).toMatchObject({ classified: 0, failed: 1, remaining: 1 })
      r = await runClassifyChunk(ctx, { limit: 10 })
      expect(r).toMatchObject({ classified: 0, failed: 1, remaining: 0, done: true })
      // Every input carried the whole thread, oldest first.
      const tomInput = classifier.calls.find((c) => c.customerEmail === 'tom.becker@example.com')!
      expect(tomInput.messages.map((m) => m.direction)).toEqual(['in', 'out', 'in'])
      expect(tomInput.messages[0]!.text).toContain('please cancel')

      const cases = await db.query<TicketRow>(
        `select customer_email, subject, case_type, case_confidence, risk_level from public.tickets
         where imported_at is not null order by first_message_at`,
      )
      expect(cases.map((t) => [t.subject, t.case_type, t.risk_level])).toEqual([
        ['Please cancel my subscription', 'cancellation_only', 'none'],
        // Below the shared threshold: unclear, the same rule the live agent follows.
        ['Feature idea: export CSV', 'unclear', 'none'],
        ['Your account', null, 'none'],
        ['Bug: follower count is wrong', 'bug_report', 'none'],
      ])
      const attempts = await db.query<{ attempts: number; last_error: string | null }>(
        `select c.attempts, c.last_error from public.ticket_classifications c
         join public.tickets t on t.id = c.ticket_id where t.customer_email = 'bob@example.org'`,
      )
      expect(attempts).toEqual([{ attempts: 3, last_error: 'Error: model down' }])
      expect(await classifyProgress(db)).toMatchObject({
        imported: 4,
        classified: 3,
        pending: 0,
        failed: 1,
      })
      expect(await scheduleImportedClassification(ctx)).toEqual({
        started: false,
        reason: 'nothing waits for a case',
      })

      const status = await mailStatus(ctx)
      expect(status).toMatchObject({
        provider: 'fake',
        mailbox: 'support@instaradar.app',
        backfill: { active: false },
        classify: { imported: 4, classified: 3, failed: 1, blocked: null },
      })
      // Closed tickets per case, the seed's closed tickets included.
      expect(status.caseCounts.cancellation_only ?? 0).toBeGreaterThanOrEqual(1)
      expect(status.caseCounts.bug_report ?? 0).toBeGreaterThanOrEqual(1)
      expect(status.caseCounts.unclear ?? 0).toBeGreaterThanOrEqual(1)
      expect(status.backfill.folders.map((f) => [f.folder, f.status])).toEqual([
        ['inbox', 'done'],
        ['sent', 'done'],
      ])
    })
  })

  it('without a model key the pass is not scheduled and the status says why', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      ctx.classifier = null
      fillMailbox(ctx)
      await startBackfill(ctx)
      await runUntilDone(ctx, { limit: 50 })
      expect(await scheduleImportedClassification(ctx)).toEqual({
        started: false,
        reason: 'ANTHROPIC_API_KEY is not set',
      })
      const status = await mailStatus(ctx)
      expect(status.classify).toMatchObject({ pending: 4, blocked: 'ANTHROPIC_API_KEY is not set' })
    })
  })

  it('runs as chunk jobs in the cron lanes and re-enqueues itself until done', async () => {
    await withRollback(async (db) => {
      resetJobHandlersForTests()
      const ctx = makeMailContext(db)
      ctx.classifier = createFakeClassifier()
      const jobs = createJobsService({ db })
      registerMailJobHandlers(jobs, ctx)
      registerTimerJobHandlers(jobs, db)
      fillMailbox(ctx)
      await liveCursorAtEnd(ctx)
      await startBackfill(ctx)
      const notify = notifySpy()
      const lane = await runFetchMailLane({
        db,
        now: new Date('2026-09-27T10:01:00Z'),
        budgetMs: 20_000,
        worker: 'lane',
        notify,
        log: () => {},
      })
      // The live fetch and one import chunk, which finished everything and scheduled classification.
      expect(lane.jobs.map((j) => [j.type, j.outcome]).sort()).toEqual([
        ['backfill_mail', 'succeeded'],
        ['fetch_mail', 'succeeded'],
      ])
      expect(await mailStatus(ctx)).toMatchObject({
        backfill: { active: false },
        classify: { pending: 4, active: true },
      })
      const tick = await runTick({
        db,
        now: new Date('2026-09-27T10:02:00Z'),
        budgetMs: 20_000,
        worker: 'tick',
        notify,
        log: () => {},
      })
      expect(tick.jobs.find((j) => j.type === 'classify_imported')).toMatchObject({
        outcome: 'succeeded',
      })
      expect(await classifyProgress(db)).toMatchObject({ classified: 4, pending: 0, active: false })
      expect(notify.calls).toEqual([])
    })
  })
})
