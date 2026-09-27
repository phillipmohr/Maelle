/**
 * The agent against Postgres (pnpm test:db): the write path, status transitions, versions, the
 * failure path, the two-stage flow across two runs, job idempotency and the agent migration.
 */
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDbForTests } from '../../../server/utils/db'
import { createDbAgentStore } from '../../../server/agent/store/db'
import { createScriptedModelClient } from '../../../server/agent/model/scripted'
import { runAgent } from '../../../server/agent/run'
import { CASE_1_CANCELLATION, CASE_2_REFUND } from '../../../evals/fixtures/cases'
import type { Fixture } from '../../../evals/fixtures/types'
import { NOW, SUPPORT } from '../../../evals/fixtures/worlds'
import { checkExpectations, harnessDeps, scriptedTurns } from '../../../evals/harness'
import { SEED_APP_ID } from '../../../shared/seed/data'

const url = process.env.TEST_DATABASE_URL

describe.skipIf(!url)('agent runs against Postgres', () => {
  let db: pg.Client
  const store = createDbAgentStore()
  const created: string[] = []

  beforeAll(async () => {
    db = new pg.Client({ connectionString: url })
    await db.connect()
  })
  afterAll(async () => {
    // Remove the tickets this suite created (cascades to messages, runs, proposals), so suites that
    // share the seeded test database (tickets list counts) keep seeing the seed only.
    if (db && created.length > 0) {
      await db.query('delete from public.tickets where id = any($1::uuid[])', [created])
    }
    await db?.end()
    await closeDbForTests()
  })

  async function insertTicket(fixture: Fixture, status = 'new'): Promise<string> {
    const t = await db.query<{ id: string }>(
      `insert into public.tickets (app_id, customer_email, customer_name, subject, status, first_message_at, last_message_at, last_customer_message_at)
       values ($1, $2, $3, $4, $5, $6, $6, $6) returning id`,
      [
        SEED_APP_ID,
        fixture.customer.email,
        fixture.customer.name,
        fixture.subject,
        status,
        fixture.messages[0]!.at,
      ],
    )
    const id = t.rows[0]!.id
    created.push(id)
    for (const m of fixture.messages) {
      await db.query(
        `insert into public.messages (ticket_id, direction, from_email, from_name, to_emails, subject, text_body, received_at, sent_at, sent_by, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          m.direction,
          m.direction === 'in' ? fixture.customer.email : SUPPORT,
          m.direction === 'in' ? fixture.customer.name : 'Anastasia',
          [m.direction === 'in' ? SUPPORT : fixture.customer.email],
          fixture.subject,
          m.text,
          m.direction === 'in' ? m.at : null,
          m.direction === 'out' ? m.at : null,
          m.direction === 'out' ? 'you' : null,
          m.at,
        ],
      )
    }
    return id
  }

  it('applied the agent migration: job id, attempt, vercel_logs with RLS', async () => {
    const cols = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'agent_runs' and column_name in ('job_id', 'attempt')`,
    )
    expect(cols.rows.map((r) => r.column_name).sort()).toEqual(['attempt', 'job_id'])
    const rls = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'vercel_logs'`,
    )
    expect(rls.rows[0]?.relrowsecurity).toBe(true)
    const policy = await db.query(
      `select 1 from pg_policies where tablename = 'vercel_logs' and policyname = 'allowed_user_all'`,
    )
    expect(policy.rowCount).toBe(1)
  })

  it('new ticket → researching → needs_decision with proposal, actions, run and ticket fields', async () => {
    const ticketId = await insertTicket(CASE_1_CANCELLATION)
    const deps = harnessDeps(CASE_1_CANCELLATION, store, { now: NOW })
    const result = await runAgent(deps, ticketId, 'new_ticket', { jobId: `job-${ticketId}` })
    expect(result.status, result.error).toBe('succeeded')

    const ticket = (await store.getTicket(ticketId))!
    const proposal = await store.getLatestProposal(ticketId)
    expect(checkExpectations(proposal, ticket, CASE_1_CANCELLATION.expect)).toEqual([])
    expect(ticket).toMatchObject({
      status: 'needs_decision',
      caseType: 'cancellation_only',
      riskLevel: 'none',
      stage: 1,
      stripeCustomerId: 'cus_TBecker0203',
      instaradarUserId: 'usr_tbecker_71c0',
    })
    expect(ticket.customerContext?.plan[0]).toEqual({ label: 'Plan', value: 'Pro Monthly' })
    expect(proposal).toMatchObject({
      version: 1,
      status: 'active',
      metaLine: '3 actions · all reversible',
    })
    expect(proposal!.actions.map((a) => a.type)).toEqual([
      'cancel_at_period_end',
      'store_cancellation_reason',
      'send_reply',
    ])

    const run = await db.query(
      `select status, error, proposal_id, progress, model, duration_ms, input_tokens, job_id, attempt from public.agent_runs where id = $1`,
      [result.runId],
    )
    expect(run.rows[0]).toMatchObject({
      status: 'succeeded',
      error: null,
      proposal_id: proposal!.id,
      model: 'claude-fable-5-1',
      job_id: `job-${ticketId}`,
      attempt: 1,
    })
    expect(run.rows[0].progress).toMatchObject({
      stripe: 'ok',
      supabase: 'ok',
      kb: 'ok',
      email: 'ok',
    })
    expect(run.rows[0].duration_ms).toBeGreaterThanOrEqual(0)

    // Idempotent: the same job again reuses the run and writes nothing new.
    const again = await runAgent(deps, ticketId, 'new_ticket', { jobId: `job-${ticketId}` })
    expect(again).toMatchObject({
      runId: result.runId,
      status: 'succeeded',
      proposalId: proposal!.id,
    })
    const count = await db.query<{ n: number }>(
      `select count(*)::int as n from public.proposals where ticket_id = $1`,
      [ticketId],
    )
    expect(count.rows[0]!.n).toBe(1)
  })

  it('rerun from needs_decision writes v2 and supersedes v1', async () => {
    const ticketId = await insertTicket(CASE_1_CANCELLATION)
    const first = await runAgent(
      harnessDeps(CASE_1_CANCELLATION, store, { now: NOW }),
      ticketId,
      'new_ticket',
    )
    expect(first.status).toBe('succeeded')
    const second = await runAgent(
      harnessDeps(CASE_1_CANCELLATION, store, { now: NOW }),
      ticketId,
      'rerun',
    )
    expect(second.status, second.error).toBe('succeeded')
    const versions = await db.query<{ version: number; status: string }>(
      `select version, status from public.proposals where ticket_id = $1 order by version`,
      [ticketId],
    )
    expect(versions.rows).toEqual([
      { version: 1, status: 'superseded' },
      { version: 2, status: 'active' },
    ])
    expect((await store.getTicket(ticketId))!.status).toBe('needs_decision')
    const runs = await db.query<{ trigger: string }>(
      `select trigger from public.agent_runs where ticket_id = $1 order by created_at`,
      [ticketId],
    )
    expect(runs.rows.map((r) => r.trigger)).toEqual(['new_ticket', 'rerun'])
  })

  it('a failed run leaves the ticket in needs_decision with the error on agent_runs', async () => {
    const ticketId = await insertTicket(CASE_1_CANCELLATION)
    const model = createScriptedModelClient([{ text: 'no' }, { text: 'no' }, { text: 'no' }])
    const result = await runAgent(
      harnessDeps(CASE_1_CANCELLATION, store, { now: NOW, model }),
      ticketId,
      'new_ticket',
    )
    expect(result.status).toBe('failed')
    const ticket = (await store.getTicket(ticketId))!
    expect(ticket.status).toBe('needs_decision')
    expect(ticket.customerContext).not.toBeNull()
    const run = await db.query<{ status: string; error: string; finished_at: Date }>(
      `select status, error, finished_at from public.agent_runs where id = $1`,
      [result.runId],
    )
    expect(run.rows[0]).toMatchObject({ status: 'failed' })
    expect(run.rows[0]!.error).toMatch(/without calling submit_proposal/)
    expect(run.rows[0]!.finished_at).not.toBeNull()
    expect(await store.getLatestProposal(ticketId)).toBeNull()
  })

  it('two-stage flow across two runs: stage 1, the customer confirms, stage 2', async () => {
    const ticketId = await insertTicket(CASE_2_REFUND)
    const stage1 = await runAgent(
      harnessDeps(CASE_2_REFUND, store, { now: NOW }),
      ticketId,
      'new_ticket',
    )
    expect(stage1.status, stage1.error).toBe('succeeded')
    const p1 = (await store.getLatestProposal(ticketId))!
    expect(checkExpectations(p1, await store.getTicket(ticketId), CASE_2_REFUND.expect)).toEqual([])
    expect((await store.getTicket(ticketId))!.waitingFor).toBe('Customer confirmation')

    // The executor sent the stage-1 reply and parked the ticket; the customer answers; the mail ticket wakes it.
    const sentAt = new Date(NOW.getTime() + 3_600_000).toISOString()
    const repliedAt = new Date(NOW.getTime() + 26 * 3_600_000).toISOString()
    await db.query(
      `insert into public.messages (ticket_id, direction, from_email, to_emails, subject, text_body, sent_at, sent_by, created_at) values ($1, 'out', $2, $3, $4, $5, $6, 'you', $6)`,
      [
        ticketId,
        SUPPORT,
        [CASE_2_REFUND.customer.email],
        `Re: ${CASE_2_REFUND.subject}`,
        p1.reply!.body,
        sentAt,
      ],
    )
    await db.query(
      `insert into public.messages (ticket_id, direction, from_email, to_emails, subject, text_body, received_at, created_at) values ($1, 'in', $2, $3, $4, $5, $6, $6)`,
      [
        ticketId,
        CASE_2_REFUND.customer.email,
        [SUPPORT],
        `Re: ${CASE_2_REFUND.subject}`,
        CASE_2_REFUND.followUp!.customerReply,
        repliedAt,
      ],
    )
    await db.query(
      `update public.tickets set status = 'waiting_on_customer', last_message_at = $2, last_customer_message_at = $2 where id = $1`,
      [ticketId, repliedAt],
    )

    const follow = CASE_2_REFUND.followUp!
    const model = createScriptedModelClient(scriptedTurns(follow.scripted))
    const stage2 = await runAgent(
      harnessDeps(CASE_2_REFUND, store, { now: new Date(repliedAt), model }),
      ticketId,
      'customer_reply',
    )
    expect(stage2.status, stage2.error).toBe('succeeded')
    const p2 = (await store.getLatestProposal(ticketId))!
    const ticket = (await store.getTicket(ticketId))!
    expect(checkExpectations(p2, ticket, follow.expect)).toEqual([])
    expect(p2.version).toBe(2)
    expect(ticket.stage).toBe(2)
    expect(ticket.waitingFor).toBeNull()
    const v1 = await db.query<{ status: string }>(
      `select status from public.proposals where id = $1`,
      [p1.id],
    )
    expect(v1.rows[0]!.status).toBe('superseded')
  })

  it('stores translations on the customer message', async () => {
    const fixture: Fixture = {
      ...CASE_1_CANCELLATION,
      messages: [{ ...CASE_1_CANCELLATION.messages[0]!, text: 'Bitte kündigen Sie mein Abo.' }],
    }
    const ticketId = await insertTicket(fixture)
    const messages = await store.getMessages(ticketId)
    const model = createScriptedModelClient([
      {
        toolCalls: [
          {
            name: 'submit_proposal',
            input: {
              ...fixture.scripted.proposal,
              translations: [
                { messageId: messages[0]!.id, translation: 'Please cancel my subscription.' },
              ],
            },
          },
        ],
      },
    ])
    const result = await runAgent(
      harnessDeps(fixture, store, { now: NOW, model }),
      ticketId,
      'new_ticket',
    )
    expect(result.status, result.error).toBe('succeeded')
    const row = await db.query<{ translation: string }>(
      `select translation from public.messages where id = $1`,
      [messages[0]!.id],
    )
    expect(row.rows[0]!.translation).toBe('Please cancel my subscription.')
  })

  it('reads previous tickets of the customer as email history', async () => {
    const first = await insertTicket(
      { ...CASE_1_CANCELLATION, subject: 'Older question' },
      'closed',
    )
    const second = await insertTicket(CASE_1_CANCELLATION)
    const history = await store.getPreviousTickets(CASE_1_CANCELLATION.customer.email, second)
    expect(history.map((h) => h.id)).toContain(first)
    expect(history.find((h) => h.id === first)!.messages[0]!.excerpt).toBe('Please unsubscribe me.')
  })
})
