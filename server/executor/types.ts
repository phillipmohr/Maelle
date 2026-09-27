/**
 * Executor types (IRDR-457). The executor is the only code that changes anything: Stripe, InstaRadar
 * data, Linear, outgoing email, ticket state. Everything here is deterministic and fully logged in
 * `action_executions`.
 */
import type { ActionParams, ActionStage, ActionType } from '#shared/actions'
import type { CaseType, RiskLevel } from '#shared/case-types'
import type { ReplyDraft } from '#shared/proposal'
import type { JobsService, MailService } from '#shared/services'
import type { TicketResolution, TicketStatus } from '#shared/status'
import type { ExecutedBy, ExecutionStatus } from '#shared/api'
import type { StripeWriteClient } from './clients/stripe'
import type { InstaradarWriteClient } from './clients/instaradar'
import type { LinearWriteClient } from './clients/linear'
import type { AuthAdminClient } from './clients/auth-admin'
import type { MaelleStore, Queryable } from './store'

export type { ExecutedBy, ExecutionStatus }

// ---------------------------------------------------------------- database records (camelCase)

export interface TicketRecord {
  id: string
  appId: string
  displayNumber: number
  customerEmail: string
  customerName: string | null
  subject: string | null
  status: TicketStatus
  resolution: TicketResolution | null
  caseType: CaseType | null
  riskLevel: RiskLevel
  stage: 1 | 2
  waitingFor: string | null
  snoozedUntil: string | null
  instaradarUserId: string | null
  stripeCustomerId: string | null
  createdAt: string
}

export interface ProposedActionRecord {
  id: string
  position: number
  type: ActionType
  params: Record<string, unknown>
  reason: string
  stage: ActionStage
  requiredForReply: boolean
  enabled: boolean
}

export interface ProposalRecord {
  id: string
  ticketId: string
  version: number
  caseType: CaseType
  stage: 1 | 2
  customerConfirmationNeeded: boolean
  policyWarnings: string[]
  riskLevel: RiskLevel
  replyDraft: ReplyDraft | null
  status: 'active' | 'superseded' | 'decided'
  createdAt: string
  actions: ProposedActionRecord[]
}

export interface ExecutionRecord {
  id: string
  ticketId: string
  proposalId: string | null
  proposedActionId: string | null
  type: ActionType
  params: Record<string, unknown>
  executedBy: ExecutedBy
  status: ExecutionStatus
  scheduledFor: string | null
  idempotencyKey: string
  attempt: number
  result: unknown
  error: string | null
  externalRefs: Record<string, string>
  irreversible: boolean
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  /** Derived: position inside the proposal (from the idempotency key). */
  position: number
  /** From the proposed action; `now` for added and manual actions. */
  stage: ActionStage
  requiredForReply: boolean
}

export interface SettingsRecord {
  appId: string
  globalPause: boolean
  undoWindowMinutes: number
  timezone: string
  refundDailyLimitCount: number
  refundDailyLimitAmountCents: number
}

// ---------------------------------------------------------------- external clients

export interface Clients {
  stripe: StripeWriteClient
  instaradar: InstaradarWriteClient
  linear: LinearWriteClient
  authAdmin: AuthAdminClient
}

/** Options every write to an external system carries. */
export interface RequestOpts {
  /** Stable per (ticket, proposal version, position); retries reuse it. */
  idempotencyKey: string
}

// ---------------------------------------------------------------- action handlers

export interface ActionContext {
  ticket: TicketRecord
  proposal: ProposalRecord | null
  executedBy: ExecutedBy
  /** Base idempotency key, without the attempt suffix. Passed to Stripe, Linear and mail. */
  idempotencyKey: string
  attempt: number
  clients: Clients
  store: MaelleStore
  settings: SettingsRecord
  mail: MailService
  now: () => Date
  /** Results of actions of the same proposal that already succeeded, by position. */
  priorResults: Map<number, unknown>
  /** The customer explicitly confirmed (stage 2, confirmation found in the thread, or the note says so). */
  customerConfirmed: boolean
  /** The reply that Send reply sends (edited or the proposal's). */
  replyDraft: ReplyDraft | null
  /** Auto only: the reply is scheduled instead of sent. */
  scheduleReplyFor: Date | null
}

export interface ActionOutcome {
  result: Record<string, unknown>
  externalRefs?: Record<string, string>
}

export interface ActionHandler<T extends ActionType = ActionType> {
  type: T
  /** What did not happen when the action fails, e.g. "nothing was charged or refunded". */
  consequence: string
  run(params: ActionParams<T>, ctx: ActionContext): Promise<ActionOutcome>
}

// ---------------------------------------------------------------- service wiring

export interface ExecutorDeps {
  /** Maelle's database (the pg pool). */
  db: () => Queryable
  clients: Clients
  store: MaelleStore
  mail: () => MailService
  jobs: () => JobsService
  now: () => Date
  log: (msg: string) => void
}
