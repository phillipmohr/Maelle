/**
 * SQL for the executor. Every function takes a `Queryable` (the pool, or the client of a
 * `withTransaction`). Ticket status changes go through `transition()` from shared/status, and the
 * caller locks the ticket row (`forUpdate`) before deciding anything.
 */
import type { ActionStage, ActionType } from '#shared/actions'
import type { CaseType, RiskLevel } from '#shared/case-types'
import type { ReplyDraft } from '#shared/proposal'
import type { RejectReason } from '#shared/services'
import { transition, type TicketResolution, type TicketStatus } from '#shared/status'
import type { DecisionKind } from '#shared/api'
import { positionOf } from './keys'
import type { Queryable } from './store'
import type {
  ExecutedBy,
  ExecutionRecord,
  ExecutionStatus,
  ProposalRecord,
  ProposedActionRecord,
  SettingsRecord,
  TicketRecord,
} from './types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Row = Record<string, unknown>

function iso(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

function str(v: unknown): string | null {
  return v == null ? null : String(v)
}

// ---------------------------------------------------------------- tickets

const TICKET_COLUMNS = `id, app_id, display_number, customer_email, customer_name, subject, status, resolution,
  case_type, risk_level, stage, waiting_for, snoozed_until, instaradar_user_id, stripe_customer_id, created_at`

function mapTicket(r: Row): TicketRecord {
  return {
    id: String(r.id),
    appId: String(r.app_id),
    displayNumber: Number(r.display_number),
    customerEmail: String(r.customer_email),
    customerName: str(r.customer_name),
    subject: str(r.subject),
    status: r.status as TicketStatus,
    resolution: (r.resolution as TicketResolution | null) ?? null,
    caseType: (r.case_type as CaseType | null) ?? null,
    riskLevel: r.risk_level as RiskLevel,
    stage: Number(r.stage) === 2 ? 2 : 1,
    waitingFor: str(r.waiting_for),
    snoozedUntil: iso(r.snoozed_until),
    instaradarUserId: str(r.instaradar_user_id),
    stripeCustomerId: str(r.stripe_customer_id),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
  }
}

/** `idOrNumber` is the ticket uuid or the display number ("4824" or "#4824"). */
export async function findTicket(
  q: Queryable,
  idOrNumber: string,
  opts: { forUpdate?: boolean } = {},
): Promise<TicketRecord | null> {
  const key = idOrNumber.trim().replace(/^#/, '')
  let where: string
  let value: unknown
  if (UUID_RE.test(key)) {
    where = 'id = $1::uuid'
    value = key
  } else if (/^\d{1,9}$/.test(key)) {
    where = 'display_number = $1::int'
    value = Number(key)
  } else {
    return null
  }
  const r = await q.query<Row>(
    `select ${TICKET_COLUMNS} from public.tickets where ${where}${opts.forUpdate ? ' for update' : ''}`,
    [value],
  )
  const row = r.rows[0]
  return row ? mapTicket(row) : null
}

export interface TicketPatch {
  resolution?: TicketResolution | null
  waitingFor?: string | null
  snoozedUntil?: string | null
  closedAt?: string | null
  stage?: 1 | 2
  caseType?: CaseType
  caseConfidence?: number
}

/** Writes the new status only when `transition(from, to)` allows it (it throws otherwise). */
export async function updateTicketStatus(
  q: Queryable,
  ticket: TicketRecord,
  to: TicketStatus,
  patch: TicketPatch = {},
): Promise<TicketRecord> {
  const next = transition(ticket.status, to)
  const sets = ['status = $2']
  const values: unknown[] = [ticket.id, next]
  const add = (col: string, v: unknown) => {
    values.push(v)
    sets.push(`${col} = $${values.length}`)
  }
  if (patch.resolution !== undefined) add('resolution', patch.resolution)
  if (patch.waitingFor !== undefined) add('waiting_for', patch.waitingFor)
  if (patch.snoozedUntil !== undefined) add('snoozed_until', patch.snoozedUntil)
  if (patch.closedAt !== undefined) add('closed_at', patch.closedAt)
  if (patch.stage !== undefined) add('stage', patch.stage)
  if (patch.caseType !== undefined) add('case_type', patch.caseType)
  if (patch.caseConfidence !== undefined) add('case_confidence', patch.caseConfidence)
  const r = await q.query<Row>(
    `update public.tickets set ${sets.join(', ')} where id = $1 returning ${TICKET_COLUMNS}`,
    values,
  )
  return mapTicket(r.rows[0]!)
}

// ---------------------------------------------------------------- proposals

const PROPOSAL_COLUMNS = `id, ticket_id, version, case_type, stage, customer_confirmation_needed, policy_warnings,
  risk_level, reply_draft, handoff_reason, status, created_at`

async function withActions(q: Queryable, row: Row): Promise<ProposalRecord> {
  const a = await q.query<Row>(
    `select id, position, action_type, params, reason, stage, required_for_reply, enabled
     from public.proposed_actions where proposal_id = $1 order by position`,
    [row.id],
  )
  const actions: ProposedActionRecord[] = a.rows.map((x) => ({
    id: String(x.id),
    position: Number(x.position),
    type: x.action_type as ActionType,
    params: (x.params as Record<string, unknown>) ?? {},
    reason: String(x.reason ?? ''),
    stage: x.stage as ActionStage,
    requiredForReply: Boolean(x.required_for_reply),
    enabled: x.enabled !== false,
  }))
  return {
    id: String(row.id),
    ticketId: String(row.ticket_id),
    version: Number(row.version),
    caseType: row.case_type as CaseType,
    stage: Number(row.stage) === 2 ? 2 : 1,
    customerConfirmationNeeded: Boolean(row.customer_confirmation_needed),
    policyWarnings: (row.policy_warnings as string[]) ?? [],
    riskLevel: row.risk_level as RiskLevel,
    replyDraft: (row.reply_draft as ReplyDraft | null) ?? null,
    handoffReason: (row.handoff_reason as string | null) ?? null,
    status: row.status as ProposalRecord['status'],
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    actions,
  }
}

export async function loadActiveProposal(
  q: Queryable,
  ticketId: string,
): Promise<ProposalRecord | null> {
  const r = await q.query<Row>(
    `select ${PROPOSAL_COLUMNS} from public.proposals where ticket_id = $1 and status = 'active' order by version desc limit 1`,
    [ticketId],
  )
  return r.rows[0] ? withActions(q, r.rows[0]) : null
}

/** The newest proposal of any status (for retry, undo and the scheduled sends). */
export async function loadLatestProposal(
  q: Queryable,
  ticketId: string,
): Promise<ProposalRecord | null> {
  const r = await q.query<Row>(
    `select ${PROPOSAL_COLUMNS} from public.proposals where ticket_id = $1 order by version desc limit 1`,
    [ticketId],
  )
  return r.rows[0] ? withActions(q, r.rows[0]) : null
}

export async function loadProposalById(
  q: Queryable,
  proposalId: string,
): Promise<ProposalRecord | null> {
  const r = await q.query<Row>(`select ${PROPOSAL_COLUMNS} from public.proposals where id = $1`, [
    proposalId,
  ])
  return r.rows[0] ? withActions(q, r.rows[0]) : null
}

export async function setProposalStatus(
  q: Queryable,
  proposalId: string,
  status: ProposalRecord['status'],
): Promise<void> {
  await q.query('update public.proposals set status = $2 where id = $1', [proposalId, status])
}

// ---------------------------------------------------------------- decisions

export interface DecisionInput {
  ticketId: string
  proposalId: string | null
  decision: DecisionKind
  rejectReason?: RejectReason | null
  note?: string | null
  replyDiff?: unknown
  actionChanges?: unknown
  timeToDecideMs?: number | null
}

export async function insertDecision(q: Queryable, d: DecisionInput): Promise<string> {
  const r = await q.query<{ id: string }>(
    `insert into public.decisions (ticket_id, proposal_id, decision, reject_reason, note, reply_diff, action_changes, time_to_decide_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      d.ticketId,
      d.proposalId,
      d.decision,
      d.rejectReason ?? null,
      d.note ?? null,
      d.replyDiff === undefined || d.replyDiff === null ? null : JSON.stringify(d.replyDiff),
      d.actionChanges === undefined || d.actionChanges === null
        ? null
        : JSON.stringify(d.actionChanges),
      d.timeToDecideMs ?? null,
    ],
  )
  return r.rows[0]!.id
}

export async function latestDecision(
  q: Queryable,
  ticketId: string,
): Promise<{
  id: string
  decision: DecisionKind
  rejectReason: RejectReason | null
  note: string | null
} | null> {
  const r = await q.query<Row>(
    `select id, decision, reject_reason, note from public.decisions where ticket_id = $1 order by decided_at desc, created_at desc limit 1`,
    [ticketId],
  )
  const row = r.rows[0]
  if (!row) return null
  return {
    id: String(row.id),
    decision: row.decision as DecisionKind,
    rejectReason: (row.reject_reason as RejectReason | null) ?? null,
    note: str(row.note),
  }
}

// ---------------------------------------------------------------- action_executions (the audit log)

const EXECUTION_SELECT = `select e.id, e.ticket_id, e.proposal_id, e.proposed_action_id, e.action_type, e.params, e.executed_by,
    e.status, e.scheduled_for, e.idempotency_key, e.attempt, e.result, e.error, e.external_refs, e.irreversible,
    e.started_at, e.finished_at, e.created_at,
    pa.stage as pa_stage, pa.required_for_reply as pa_required_for_reply
  from public.action_executions e
  left join public.proposed_actions pa on pa.id = e.proposed_action_id`

function mapExecution(r: Row): ExecutionRecord {
  return {
    id: String(r.id),
    ticketId: String(r.ticket_id),
    proposalId: str(r.proposal_id),
    proposedActionId: str(r.proposed_action_id),
    type: r.action_type as ActionType,
    params: (r.params as Record<string, unknown>) ?? {},
    executedBy: r.executed_by as ExecutedBy,
    status: r.status as ExecutionStatus,
    scheduledFor: iso(r.scheduled_for),
    idempotencyKey: String(r.idempotency_key),
    attempt: Number(r.attempt),
    result: r.result ?? null,
    error: str(r.error),
    externalRefs: (r.external_refs as Record<string, string>) ?? {},
    irreversible: Boolean(r.irreversible),
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    position: positionOf(String(r.idempotency_key)),
    stage: (r.pa_stage as ActionStage | null) ?? 'now',
    requiredForReply: Boolean(r.pa_required_for_reply),
  }
}

export async function listExecutions(q: Queryable, ticketId: string): Promise<ExecutionRecord[]> {
  const r = await q.query<Row>(
    `${EXECUTION_SELECT} where e.ticket_id = $1 order by e.created_at, e.attempt`,
    [ticketId],
  )
  return r.rows.map(mapExecution)
}

export async function getExecution(q: Queryable, id: string): Promise<ExecutionRecord | null> {
  const r = await q.query<Row>(`${EXECUTION_SELECT} where e.id = $1`, [id])
  return r.rows[0] ? mapExecution(r.rows[0]) : null
}

export interface NewExecution {
  ticketId: string
  proposalId: string | null
  proposedActionId: string | null
  type: ActionType
  params: Record<string, unknown>
  executedBy: ExecutedBy
  status: ExecutionStatus
  idempotencyKey: string
  attempt: number
  irreversible: boolean
  scheduledFor?: string | null
  result?: unknown
}

/** Insert-or-get on the unique idempotency key: a second insert returns the existing row. */
export async function insertExecution(q: Queryable, e: NewExecution): Promise<ExecutionRecord> {
  await q.query(
    `insert into public.action_executions
       (ticket_id, proposal_id, proposed_action_id, action_type, params, executed_by, status, scheduled_for, idempotency_key, attempt, irreversible, result)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (idempotency_key) do nothing`,
    [
      e.ticketId,
      e.proposalId,
      e.proposedActionId,
      e.type,
      JSON.stringify(e.params),
      e.executedBy,
      e.status,
      e.scheduledFor ?? null,
      e.idempotencyKey,
      e.attempt,
      e.irreversible,
      e.result === undefined || e.result === null ? null : JSON.stringify(e.result),
    ],
  )
  const r = await q.query<Row>(`${EXECUTION_SELECT} where e.idempotency_key = $1`, [
    e.idempotencyKey,
  ])
  return mapExecution(r.rows[0]!)
}

export interface ExecutionPatch {
  status?: ExecutionStatus
  result?: unknown
  error?: string | null
  externalRefs?: Record<string, string>
  startedAt?: string | null
  finishedAt?: string | null
  scheduledFor?: string | null
  params?: Record<string, unknown>
  executedBy?: ExecutedBy
}

export async function updateExecution(
  q: Queryable,
  id: string,
  patch: ExecutionPatch,
): Promise<ExecutionRecord> {
  const sets: string[] = []
  const values: unknown[] = [id]
  const add = (col: string, v: unknown) => {
    values.push(v)
    sets.push(`${col} = $${values.length}`)
  }
  if (patch.status !== undefined) add('status', patch.status)
  if (patch.result !== undefined)
    add('result', patch.result === null ? null : JSON.stringify(patch.result))
  if (patch.error !== undefined) add('error', patch.error)
  if (patch.externalRefs !== undefined) add('external_refs', JSON.stringify(patch.externalRefs))
  if (patch.startedAt !== undefined) add('started_at', patch.startedAt)
  if (patch.finishedAt !== undefined) add('finished_at', patch.finishedAt)
  if (patch.scheduledFor !== undefined) add('scheduled_for', patch.scheduledFor)
  if (patch.params !== undefined) add('params', JSON.stringify(patch.params))
  if (patch.executedBy !== undefined) add('executed_by', patch.executedBy)
  if (sets.length === 0) return (await getExecution(q, id))!
  await q.query(`update public.action_executions set ${sets.join(', ')} where id = $1`, values)
  return (await getExecution(q, id))!
}

/**
 * The ticket's scheduled rows, locked for the caller's transaction. A row the runner has already
 * claimed (running) is excluded; a row the runner is claiming right now blocks until that claim
 * commits and is then excluded too, so undo and runDueScheduled never both act on the same reply.
 */
export async function lockScheduledExecutions(
  q: Queryable,
  ticketId: string,
): Promise<ExecutionRecord[]> {
  const r = await q.query<Row>(
    `${EXECUTION_SELECT} where e.ticket_id = $1 and e.status = 'scheduled' order by e.created_at for update of e`,
    [ticketId],
  )
  return r.rows.map(mapExecution)
}

/** Scheduled Auto replies whose time has come. Locks them so a parallel tick skips them. */
export async function claimDueScheduled(q: Queryable, now: Date): Promise<ExecutionRecord[]> {
  const r = await q.query<Row>(
    `${EXECUTION_SELECT} where e.status = 'scheduled' and e.scheduled_for <= $1 order by e.scheduled_for for update of e skip locked`,
    [now.toISOString()],
  )
  return r.rows.map(mapExecution)
}

// ---------------------------------------------------------------- settings, locks

export async function loadSettings(q: Queryable, appId: string): Promise<SettingsRecord> {
  const r = await q.query<Row>(
    `select global_pause, undo_window_minutes, timezone, refund_daily_limit_count, refund_daily_limit_amount_cents
     from public.settings where app_id = $1`,
    [appId],
  )
  const row = r.rows[0]
  return {
    appId,
    globalPause: Boolean(row?.global_pause ?? false),
    undoWindowMinutes: Number(row?.undo_window_minutes ?? 10),
    timezone: String(row?.timezone ?? 'Europe/Berlin'),
    refundDailyLimitCount: Number(row?.refund_daily_limit_count ?? 3),
    refundDailyLimitAmountCents: Number(row?.refund_daily_limit_amount_cents ?? 10_000),
  }
}

/** Explicit lock rows; missing rows mean "registry default" (`lockedByDefault`). */
export async function loadLocks(q: Queryable, appId: string): Promise<Map<ActionType, boolean>> {
  const r = await q.query<Row>(
    `select action_type, locked from public.action_locks where app_id = $1`,
    [appId],
  )
  return new Map(r.rows.map((x) => [x.action_type as ActionType, Boolean(x.locked)]))
}
