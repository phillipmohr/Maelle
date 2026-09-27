/**
 * Harness for the executor's database tests. Each test file clones the seeded test database into its
 * own database (CREATE DATABASE … TEMPLATE …), so the foundation's schema assertions and other
 * tickets' tests never see our mutations, and points the server's pg pool at the clone.
 */
import pg from 'pg'
import type { ReplyDraft } from '../../../shared/proposal'
import type { ActionStage, ActionType } from '../../../shared/actions'
import type { CaseType, RiskLevel } from '../../../shared/case-types'
import { createStubJobs } from '../../../shared/services-stubs'
import { closeDbForTests, getPool } from '../../../server/utils/db'
import { createFakeClients } from '../../../server/executor/clients'
import { createPgStore } from '../../../server/executor/store'
import { createExecutorService } from '../../../server/executor/service'
import { createRecordingMail } from '../../executor/helpers'

export const TEST_URL = process.env.TEST_DATABASE_URL

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function createIsolatedDb(suffix: string): Promise<string> {
  const base = new URL(TEST_URL!)
  const template = base.pathname.slice(1)
  const name = `${template}_${suffix}`
  const adminUrl = new URL(base)
  adminUrl.pathname = '/postgres'
  const admin = new pg.Client({ connectionString: adminUrl.toString() })
  await admin.connect()
  try {
    await admin.query(`drop database if exists "${name}" with (force)`)
    const deadline = Date.now() + 50_000
    for (;;) {
      try {
        await admin.query(`create database "${name}" template "${template}"`)
        break
      } catch (e) {
        // 55006: the template is in use by another test file; wait for it to finish.
        if ((e as { code?: string }).code === '55006' && Date.now() < deadline) {
          await sleep(250)
          continue
        }
        throw e
      }
    }
  } finally {
    await admin.end()
  }
  const u = new URL(base)
  u.pathname = `/${name}`
  return u.toString()
}

export interface ActionSpec {
  type: ActionType
  params: Record<string, unknown>
  stage?: ActionStage
  requiredForReply?: boolean
  enabled?: boolean
}

export interface TicketSpec {
  caseType: CaseType
  actions: ActionSpec[]
  reply?: ReplyDraft | null
  email?: string
  name?: string
  risk?: RiskLevel
  status?: string
  stage?: 1 | 2
  confirmationNeeded?: boolean
  policyWarnings?: string[]
  stripeCustomerId?: string | null
  instaradarUserId?: string | null
  proposalRisk?: RiskLevel
}

export async function setupExecutorTest(suffix: string) {
  const url = await createIsolatedDb(suffix)
  process.env.TEST_DATABASE_URL = url
  delete process.env.SUPABASE_DB_URL
  const fakes = createFakeClients()
  const mail = createRecordingMail()
  const jobs = createStubJobs()
  const clock = { now: new Date() }
  const executor = createExecutorService({
    db: () => getPool(),
    clients: fakes.clients,
    store: createPgStore(() => getPool()),
    mail: () => mail,
    jobs: () => jobs,
    now: () => clock.now,
    log: () => {},
  })
  const q = <T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ) =>
    getPool()
      .query<T>(text, params)
      .then((r) => r.rows)
  const appId = (await q<{ id: string }>('select id from public.apps limit 1'))[0]!.id

  async function ticket(idOrNumber: string) {
    const key = idOrNumber.replace(/^#/, '')
    const where = /^\d+$/.test(key) ? 'display_number = $1::int' : 'id = $1::uuid'
    const rows = await q<Record<string, unknown>>(`select * from public.tickets where ${where}`, [
      /^\d+$/.test(key) ? Number(key) : key,
    ])
    return rows[0]!
  }
  const executions = (ticketId: string) =>
    q<Record<string, unknown>>(
      'select * from public.action_executions where ticket_id = $1 order by created_at, attempt',
      [ticketId],
    )
  const decisions = (ticketId: string) =>
    q<Record<string, unknown>>(
      'select * from public.decisions where ticket_id = $1 order by decided_at, created_at',
      [ticketId],
    )
  const proposalStatus = async (ticketId: string) =>
    (
      await q<{ status: string; version: number }>(
        'select status, version from public.proposals where ticket_id = $1 order by version desc limit 1',
        [ticketId],
      )
    )[0]!

  /** Inserts a ticket with an active v1 proposal, like the agent would. */
  async function insertTicket(spec: TicketSpec) {
    const email = spec.email ?? `customer+${Math.random().toString(36).slice(2, 8)}@example.com`
    const t = await q<{ id: string; display_number: number }>(
      `insert into public.tickets (app_id, customer_email, customer_name, subject, status, case_type, case_confidence, risk_level, stage, stripe_customer_id, instaradar_user_id, first_message_at, last_message_at, last_customer_message_at)
       values ($1, $2, $3, 'Test', $4, $5, 0.95, $6, $7, $8, $9, now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour')
       returning id, display_number`,
      [
        appId,
        email,
        spec.name ?? 'Test Customer',
        spec.status ?? 'needs_decision',
        spec.caseType,
        spec.risk ?? 'none',
        spec.stage ?? 1,
        spec.stripeCustomerId ?? null,
        spec.instaradarUserId ?? null,
      ],
    )
    const ticketId = t[0]!.id
    const reply: ReplyDraft | null =
      spec.reply === undefined
        ? {
            template: null,
            templateNotionPageId: null,
            to: email,
            subject: 'Re: Test',
            body: 'Hi, thanks for reaching out!\n\nDone.\n\nBest regards,\nAnastasia',
            attachments: [],
          }
        : spec.reply
    const p = await q<{ id: string }>(
      `insert into public.proposals (ticket_id, version, case_type, confidence, summary_line, risk_level, customer_confirmation_needed, stage, policy_warnings, reply_draft, status, created_at)
       values ($1, 1, $2, 0.95, 'Test proposal', $3, $4, $5, $6, $7, 'active', now() - interval '40 seconds')
       returning id`,
      [
        ticketId,
        spec.caseType,
        spec.proposalRisk ?? spec.risk ?? 'none',
        spec.confirmationNeeded ?? false,
        spec.stage ?? 1,
        spec.policyWarnings ?? [],
        reply ? JSON.stringify(reply) : null,
      ],
    )
    const proposalId = p[0]!.id
    for (const [i, a] of spec.actions.entries()) {
      await q(
        `insert into public.proposed_actions (proposal_id, position, action_type, params, reason, stage, required_for_reply, enabled)
         values ($1, $2, $3, $4, 'Because: test', $5, $6, $7)`,
        [
          proposalId,
          i,
          a.type,
          JSON.stringify(a.params),
          a.stage ?? 'now',
          a.requiredForReply ?? false,
          a.enabled ?? true,
        ],
      )
    }
    return { ticketId, proposalId, displayNumber: t[0]!.display_number, email, reply }
  }

  const allEnabled = (n: number) =>
    Array.from({ length: n }, (_, position) => ({ position, enabled: true }))

  return {
    url,
    executor,
    fakes,
    mail,
    jobs,
    clock,
    q,
    appId,
    ticket,
    executions,
    decisions,
    proposalStatus,
    insertTicket,
    allEnabled,
    async teardown() {
      await closeDbForTests()
    },
  }
}

export type ExecutorTest = Awaited<ReturnType<typeof setupExecutorTest>>
