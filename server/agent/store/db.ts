/**
 * Postgres store on Maelle's own database (server/utils/db.ts). The same SQL runs in production
 * (SUPABASE_DB_URL) and in `pnpm test:db` (TEST_DATABASE_URL).
 */
import type pg from 'pg'
import type { MessageRow, ProposalRow, ProposedActionRow, TicketRow } from '#shared/api'
import { proposalMetaLine } from '#shared/proposal'
import { toCamel } from '#shared/seed/views'
import { dbOne, dbQuery, withTransaction } from '../../utils/db'
import type { PreviousTicketSummary } from '../types'
import type { AgentStore } from './types'

type Row = Record<string, unknown>

/** pg returns Date objects for timestamptz; the API shapes carry ISO strings. */
function normalise<T>(row: Row): T {
  const out: Row = {}
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v
  return toCamel<T>(out)
}

const TICKET_COLUMNS = `id, app_id, display_number, customer_email, customer_name, subject, status, resolution,
  case_type, case_confidence, risk_level, risk_reason, due_date::text as due_date, stage, waiting_for, snoozed_until,
  tags, instaradar_user_id, stripe_customer_id, customer_context, first_message_at, last_message_at,
  last_customer_message_at, closed_at, created_at, updated_at`

const MESSAGE_COLUMNS = `id, ticket_id, direction, from_email, from_name, to_emails, subject, text_body, html_body,
  translation, attachments, received_at, sent_at, sent_by, created_at`

const PROPOSAL_COLUMNS = `id, ticket_id, run_id, version, case_type, confidence, candidate_cases, summary_line,
  meta_line, risk_level, risk_reason, due_date::text as due_date, customer_confirmation_needed, stage, research,
  research_warnings, policy_warnings, conclusion, reply_draft, knowledge_refs, no_knowledge_found, handoff_reason,
  status, created_at`

async function proposalWithActions(
  q: <T extends pg.QueryResultRow>(text: string, params?: unknown[]) => Promise<T[]>,
  row: Row,
): Promise<ProposalRow> {
  const actions = await q<Row>(
    `select id, proposal_id, position, action_type, params, reason, stage, required_for_reply, enabled
     from public.proposed_actions where proposal_id = $1 order by position`,
    [row.id],
  )
  const p = normalise<Record<string, unknown>>(row)
  return {
    ...(p as unknown as ProposalRow),
    reply: (row.reply_draft as ProposalRow['reply']) ?? null,
    actions: actions.map((a) => {
      const c = normalise<Record<string, unknown>>(a)
      return { ...c, type: a.action_type } as unknown as ProposedActionRow
    }),
  }
}

export function createDbAgentStore(): AgentStore {
  return {
    kind: 'db',
    async getTicket(id) {
      const row = await dbOne<Row>(`select ${TICKET_COLUMNS} from public.tickets where id = $1`, [
        id,
      ])
      return row ? normalise<TicketRow>(row) : null
    },
    async getMessages(ticketId) {
      const rows = await dbQuery<Row>(
        `select ${MESSAGE_COLUMNS} from public.messages where ticket_id = $1 order by created_at, id`,
        [ticketId],
      )
      return rows.map((r) => normalise<MessageRow>(r))
    },
    async getPreviousTickets(email, exclude): Promise<PreviousTicketSummary[]> {
      const tickets = await dbQuery<Row>(
        `select id, display_number, subject, status, case_type, resolution, created_at, closed_at
         from public.tickets where lower(customer_email) = lower($1) and id <> $2
         order by created_at desc limit 10`,
        [email, exclude],
      )
      if (tickets.length === 0) return []
      const msgs = await dbQuery<Row>(
        `select ticket_id, direction, created_at, left(coalesce(text_body, ''), 300) as excerpt
         from public.messages where ticket_id = any($1::uuid[]) order by created_at`,
        [tickets.map((t) => t.id)],
      )
      return tickets.map((t) => ({
        id: String(t.id),
        displayNumber: Number(t.display_number),
        subject: (t.subject as string | null) ?? null,
        status: String(t.status),
        caseType: (t.case_type as string | null) ?? null,
        resolution: (t.resolution as string | null) ?? null,
        createdAt: (t.created_at as Date).toISOString(),
        closedAt: t.closed_at ? (t.closed_at as Date).toISOString() : null,
        messages: msgs
          .filter((m) => m.ticket_id === t.id)
          .map((m) => ({
            direction: m.direction as 'in' | 'out',
            at: (m.created_at as Date).toISOString(),
            excerpt: String(m.excerpt),
          })),
      }))
    },
    async getLatestProposal(ticketId) {
      const row = await dbOne<Row>(
        `select ${PROPOSAL_COLUMNS} from public.proposals where ticket_id = $1 order by version desc limit 1`,
        [ticketId],
      )
      return row ? proposalWithActions(dbQuery, row) : null
    },
    async getReleaseNotificationForTicket(ticketId) {
      const row = await dbOne<Row>(
        `select linear_issue_identifier, linear_issue_id, email, ticket_id
         from public.release_notifications where notification_ticket_id = $1 order by created_at desc limit 1`,
        [ticketId],
      )
      return row
        ? {
            linearIssueIdentifier: String(row.linear_issue_identifier),
            linearIssueId: (row.linear_issue_id as string | null) ?? null,
            email: String(row.email),
            originalTicketId: (row.ticket_id as string | null) ?? null,
          }
        : null
    },
    async beginRun(ticketId, trigger, model, jobId) {
      if (jobId) {
        const existing = await dbOne<Row>(
          `select id, status, started_at, proposal_id, attempt from public.agent_runs where job_id = $1`,
          [jobId],
        )
        if (existing) {
          const attempt = Number(existing.attempt ?? 1)
          if (existing.status === 'succeeded')
            return {
              runId: String(existing.id),
              reused: 'succeeded',
              proposalId: (existing.proposal_id as string | null) ?? null,
              attempt,
            }
          const startedAt = existing.started_at ? (existing.started_at as Date).getTime() : 0
          if (existing.status === 'running' && Date.now() - startedAt < 10 * 60_000)
            return { runId: String(existing.id), reused: 'running', proposalId: null, attempt }
          await dbQuery(
            `update public.agent_runs set status = 'running', started_at = now(), finished_at = null, duration_ms = null,
               error = null, progress = '{}'::jsonb, attempt = attempt + 1 where id = $1`,
            [existing.id],
          )
          return {
            runId: String(existing.id),
            reused: null,
            proposalId: null,
            attempt: attempt + 1,
          }
        }
      }
      const row = await dbOne<Row>(
        `insert into public.agent_runs (ticket_id, trigger, status, progress, started_at, model, job_id)
         values ($1, $2, 'running', '{}'::jsonb, now(), $3, $4) returning id`,
        [ticketId, trigger, model, jobId],
      )
      return { runId: String(row!.id), reused: null, proposalId: null, attempt: 1 }
    },
    async updateRunProgress(runId, progress) {
      await dbQuery(`update public.agent_runs set progress = $2::jsonb where id = $1`, [
        runId,
        JSON.stringify(progress),
      ])
    },
    async finishRun(runId, f) {
      await dbQuery(
        `update public.agent_runs set status = $2, error = $3, proposal_id = coalesce($4::uuid, proposal_id),
           finished_at = now(), duration_ms = $5, input_tokens = $6, output_tokens = $7,
           cache_read_tokens = $8, cache_creation_tokens = $9, cost_usd = $10 where id = $1`,
        [
          runId,
          f.status,
          f.error ?? null,
          f.proposalId ?? null,
          Math.round(f.durationMs),
          f.inputTokens ?? null,
          f.outputTokens ?? null,
          f.cacheReadTokens ?? null,
          f.cacheCreationTokens ?? null,
          f.costUsd ?? null,
        ],
      )
    },
    async setTicketStatus(ticketId, from, to) {
      // Leaving `closed` (re-open and draft a reply) clears the closing marks, as a customer reply does.
      const rows = await dbQuery<Row>(
        `update public.tickets set status = $3,
           closed_at = case when $2 = 'closed' then null else closed_at end,
           resolution = case when $2 = 'closed' then null else resolution end
         where id = $1 and status = $2 returning id`,
        [ticketId, from, to],
      )
      if (rows.length === 0) {
        const current = await dbOne<Row>(`select status from public.tickets where id = $1`, [
          ticketId,
        ])
        throw new Error(
          current
            ? `Ticket ${ticketId} is ${String(current.status)}, expected ${from}`
            : `Ticket ${ticketId} not found`,
        )
      }
    },
    async writeProposal({ ticketId, runId, proposal, ticket: patch, fromStatus, toStatus }) {
      return withTransaction(async (tx) => {
        const q = async <T extends pg.QueryResultRow>(text: string, params: unknown[] = []) =>
          (await tx.query<T>(text, params)).rows
        const locked = await q<Row>(`select status from public.tickets where id = $1 for update`, [
          ticketId,
        ])
        if (locked.length === 0) throw new Error(`Ticket ${ticketId} not found`)
        if (locked[0]!.status !== fromStatus)
          throw new Error(
            `Ticket ${ticketId} is ${String(locked[0]!.status)}, expected ${fromStatus}`,
          )
        const v = await q<{ v: number }>(
          `select coalesce(max(version), 0)::int + 1 as v from public.proposals where ticket_id = $1`,
          [ticketId],
        )
        const version = v[0]!.v
        await q(
          `update public.proposals set status = 'superseded' where ticket_id = $1 and status = 'active'`,
          [ticketId],
        )
        const inserted = await q<{ id: string }>(
          `insert into public.proposals (ticket_id, run_id, version, case_type, confidence, candidate_cases, summary_line,
             meta_line, risk_level, risk_reason, due_date, customer_confirmation_needed, stage, research, research_warnings,
             policy_warnings, conclusion, reply_draft, knowledge_refs, no_knowledge_found, handoff_reason, status)
           values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17, $18::jsonb, $19::jsonb, $20, $21, 'active')
           returning id`,
          [
            ticketId,
            runId,
            version,
            proposal.case,
            proposal.confidence,
            JSON.stringify(proposal.candidateCases),
            proposal.summaryLine,
            proposal.metaLine ?? proposalMetaLine(proposal),
            proposal.risk.level,
            proposal.risk.reason,
            proposal.risk.dueDate,
            proposal.customerConfirmationNeeded,
            proposal.stage,
            JSON.stringify(proposal.research),
            proposal.researchWarnings,
            proposal.policyWarnings,
            proposal.conclusion,
            proposal.reply ? JSON.stringify(proposal.reply) : null,
            JSON.stringify(proposal.knowledgeRefs),
            proposal.noKnowledgeFound,
            proposal.handoff?.reason ?? null,
          ],
        )
        const proposalId = inserted[0]!.id
        for (const [i, a] of proposal.actions.entries()) {
          await q(
            `insert into public.proposed_actions (proposal_id, position, action_type, params, reason, stage, required_for_reply, enabled)
             values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
            [
              proposalId,
              i,
              a.type,
              JSON.stringify(a.params),
              a.reason,
              a.stage,
              a.requiredForReply,
              a.enabled,
            ],
          )
        }
        const updated = await q<Row>(
          `update public.tickets set case_type = $3, case_confidence = $4, risk_level = $5, risk_reason = $6, due_date = $7,
             stage = $8, instaradar_user_id = coalesce($9, instaradar_user_id), stripe_customer_id = coalesce($10, stripe_customer_id),
             customer_context = $11::jsonb, tags = $12, waiting_for = $13, status = $14
           where id = $1 and status = $2 returning id`,
          [
            ticketId,
            fromStatus,
            patch.caseType,
            patch.caseConfidence,
            patch.riskLevel,
            patch.riskReason,
            patch.dueDate,
            patch.stage,
            patch.instaradarUserId,
            patch.stripeCustomerId,
            patch.customerContext ? JSON.stringify(patch.customerContext) : null,
            patch.tags,
            patch.waitingFor,
            toStatus,
          ],
        )
        if (updated.length === 0)
          throw new Error(`Ticket ${ticketId} changed status during the run`)
        await q(`update public.agent_runs set proposal_id = $2 where id = $1`, [runId, proposalId])
        return { proposalId, version }
      })
    },
    async markRunFailed(ticketId, from, to, patch) {
      const rows = await dbQuery<Row>(
        `update public.tickets set status = $3,
           customer_context = coalesce($4::jsonb, customer_context),
           tags = coalesce($5, tags),
           instaradar_user_id = coalesce($6, instaradar_user_id),
           stripe_customer_id = coalesce($7, stripe_customer_id)
         where id = $1 and status = $2 returning id`,
        [
          ticketId,
          from,
          to,
          patch.customerContext ? JSON.stringify(patch.customerContext) : null,
          patch.tags,
          patch.instaradarUserId,
          patch.stripeCustomerId,
        ],
      )
      if (rows.length === 0) throw new Error(`Ticket ${ticketId} is not ${from} any more`)
    },
    async setMessageTranslation(ticketId, messageId, translation) {
      await dbQuery(
        `update public.messages set translation = $3 where id = $1 and ticket_id = $2`,
        [messageId, ticketId, translation],
      )
    },
  }
}
