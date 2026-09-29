/**
 * The agent's view of Maelle's own database. Two implementations: Postgres (server/utils/db.ts)
 * and memory (unit tests, evals). Every write the agent makes goes through this interface, so a
 * grep of this folder shows exactly what the agent can change: agent_runs, proposals,
 * proposed_actions, the ticket fields listed here and messages.translation.
 */
import type { CustomerContext, MessageRow, ProposalRow, TicketRow } from '#shared/api'
import type { CaseType, RiskLevel } from '#shared/case-types'
import type { Proposal } from '#shared/proposal'
import type { AgentTrigger } from '#shared/services'
import type { TicketStatus } from '#shared/status'
import type { PreviousTicketSummary, Progress } from '../types'

export interface RunStart {
  runId: string
  /** Set when the same job already produced a result (idempotency). */
  reused: 'succeeded' | 'running' | null
  proposalId: string | null
  attempt: number
}

export interface RunFinish {
  status: 'succeeded' | 'failed'
  error?: string | null
  proposalId?: string | null
  durationMs: number
  /** Uncached input tokens of this attempt; the cache kinds and the cost have their own fields. */
  inputTokens?: number | null
  outputTokens?: number | null
  cacheReadTokens?: number | null
  cacheCreationTokens?: number | null
  costUsd?: number | null
}

export interface TicketFieldsPatch {
  caseType: CaseType
  caseConfidence: number
  riskLevel: RiskLevel
  riskReason: string | null
  dueDate: string | null
  stage: 1 | 2
  instaradarUserId: string | null
  stripeCustomerId: string | null
  customerContext: CustomerContext | null
  tags: string[]
  waitingFor: string | null
}

export interface WriteProposalArgs {
  ticketId: string
  runId: string
  proposal: Proposal
  ticket: TicketFieldsPatch
  fromStatus: TicketStatus
  toStatus: TicketStatus
}

export interface FailPatch {
  customerContext: CustomerContext | null
  tags: string[] | null
  instaradarUserId: string | null
  stripeCustomerId: string | null
}

export interface ReleaseNotificationRef {
  linearIssueIdentifier: string
  linearIssueId: string | null
  email: string
  originalTicketId: string | null
}

export interface AgentStore {
  readonly kind: 'db' | 'memory'
  getTicket(ticketId: string): Promise<TicketRow | null>
  getMessages(ticketId: string): Promise<MessageRow[]>
  getPreviousTickets(
    customerEmail: string,
    excludeTicketId: string,
  ): Promise<PreviousTicketSummary[]>
  getLatestProposal(ticketId: string): Promise<ProposalRow | null>
  getReleaseNotificationForTicket(ticketId: string): Promise<ReleaseNotificationRef | null>
  beginRun(
    ticketId: string,
    trigger: AgentTrigger,
    model: string,
    jobId: string | null,
  ): Promise<RunStart>
  updateRunProgress(runId: string, progress: Progress): Promise<void>
  finishRun(runId: string, finish: RunFinish): Promise<void>
  /** Sets the status; the caller validated the transition. Throws when the current status changed underneath. */
  setTicketStatus(ticketId: string, from: TicketStatus, to: TicketStatus): Promise<void>
  writeProposal(args: WriteProposalArgs): Promise<{ proposalId: string; version: number }>
  /** Failure path: the ticket shows the error state with a re-run option. */
  markRunFailed(
    ticketId: string,
    from: TicketStatus,
    to: TicketStatus,
    patch: FailPatch,
  ): Promise<void>
  setMessageTranslation(ticketId: string, messageId: string, translation: string): Promise<void>
}
