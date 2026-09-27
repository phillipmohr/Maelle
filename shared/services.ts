/**
 * Service interfaces. Each interface is owned by one ticket; every other ticket codes against the
 * interface. Stub implementations live in `shared/services-stubs.ts` and are wired in
 * `server/utils/services.ts`; owners replace them from a Nitro plugin in their own folder.
 */
import type { CaseType, RiskLevel } from './case-types'
import type { ReplyDraft } from './proposal'
import type { ActionType } from './actions'

// ---------------------------------------------------------------- jobs (IRDR-455)

export const JOB_TYPES = [
  'agent_run',
  'run_due_scheduled',
  'daily_digest',
  'fetch_mail',
  'wake_snoozed',
  'waiting_follow_up',
  'send_reply',
  'send_system_email',
] as const
export type JobType = (typeof JOB_TYPES)[number]

export const AGENT_TRIGGERS = [
  'new_ticket',
  'customer_reply',
  'case_override',
  'follow_up',
  'release_notification',
  'rerun',
] as const
export type AgentTrigger = (typeof AGENT_TRIGGERS)[number]

export interface JobPayloads {
  agent_run: { ticketId: string; trigger: AgentTrigger }
  run_due_scheduled: Record<string, never>
  daily_digest: Record<string, never>
  fetch_mail: Record<string, never>
  wake_snoozed: Record<string, never>
  waiting_follow_up: Record<string, never>
  send_reply: { ticketId: string; executionId: string }
  send_system_email: { to: string; subject: string; body: string }
}

export interface JobHandle {
  id: string
  type: JobType
  runAt: string
}

export type JobHandler<T extends JobType = JobType> = (
  payload: JobPayloads[T],
  ctx: { jobId: string; attempt: number },
) => Promise<void>

export interface JobsService {
  /** Enqueue a job; `runAt` defaults to now. Retries, backoff and dead-letter are the runner's job. */
  enqueue<T extends JobType>(type: T, payload: JobPayloads[T], runAt?: Date): Promise<JobHandle>
  /** Register the handler for a job type. Owners: agent → agent_run, executor → run_due_scheduled, autonomy → daily_digest. */
  registerHandler<T extends JobType>(type: T, handler: JobHandler<T>): void
  /** Returns the registered handler (used by the runner and by tests). */
  getHandler<T extends JobType>(type: T): JobHandler<T> | undefined
}

// ---------------------------------------------------------------- mail (IRDR-455)

export interface SentMail {
  /** Maelle `messages.id` of the stored outgoing message. */
  messageId: string
  /** Provider id (Gmail message id or IMAP UID) for exactly-once sends. */
  providerMessageId: string
  /** RFC 5322 Message-ID header of the sent mail. */
  rfcMessageId: string
}

export interface MailService {
  /** Sends the draft into the ticket's thread from support@instaradar.app. Exactly once per (ticket, draft). */
  sendReply(
    ticketId: string,
    draft: ReplyDraft,
    opts?: { sentBy: 'you' | 'auto'; idempotencyKey?: string },
  ): Promise<SentMail>
  /** Alerts and digests to NOTIFY_EMAIL. */
  sendSystemEmail(to: string, subject: string, body: string): Promise<void>
}

// ---------------------------------------------------------------- agent (IRDR-456)

export interface AgentRunResult {
  runId: string
  status: 'succeeded' | 'failed'
  proposalId?: string
  error?: string
}

export interface AgentService {
  /** Runs the agent for a ticket. Idempotent per run; registered as the `agent_run` job handler. */
  run(ticketId: string, trigger: AgentTrigger): Promise<AgentRunResult>
}

// ---------------------------------------------------------------- executor (IRDR-457)

export interface ApproveActionInput {
  /** Position of the proposed action in the proposal. */
  position: number
  enabled: boolean
  /** Edited params; omitted means unchanged. */
  params?: Record<string, unknown>
}

export interface ApproveInput {
  proposalVersion: number
  actions: ApproveActionInput[]
  /** Edited reply; omitted means unchanged. */
  reply?: Pick<ReplyDraft, 'subject' | 'body'> & Partial<Pick<ReplyDraft, 'attachments'>>
  confirmIrreversible?: boolean
  /** Actions added from the registry that were not in the proposal. */
  addedActions?: { type: ActionType; params: Record<string, unknown>; reason: string }[]
  note?: string
}

export type RejectReason = 'wrong_case' | 'wrong_actions' | 'wrong_tone' | 'handle_myself'
export const REJECT_REASONS = [
  'wrong_case',
  'wrong_actions',
  'wrong_tone',
  'handle_myself',
] as const

export interface ExecutionSummary {
  executionId: string
  type: ActionType
  status: 'queued' | 'scheduled' | 'running' | 'succeeded' | 'failed' | 'held' | 'cancelled'
  result?: unknown
  error?: string
}

export interface ApproveResult {
  decisionId: string
  ticketStatus: string
  executions: ExecutionSummary[]
}

export interface ExecutorService {
  approve(ticketId: string, input: ApproveInput, by: 'you' | 'auto'): Promise<ApproveResult>
  reject(ticketId: string, reason: RejectReason, note?: string): Promise<{ decisionId: string }>
  manualSend(
    ticketId: string,
    input: {
      reply: Pick<ReplyDraft, 'to' | 'subject' | 'body'>
      actions: { type: ActionType; params: Record<string, unknown> }[]
      handledManually: boolean
    },
  ): Promise<ApproveResult>
  snooze(ticketId: string, until: Date): Promise<void>
  unsnooze(ticketId: string): Promise<void>
  retry(ticketId: string): Promise<ApproveResult>
  markDone(ticketId: string, note: string): Promise<void>
  setCase(ticketId: string, caseType: CaseType): Promise<void>
  undo(ticketId: string): Promise<{ cancelled: ExecutionSummary[]; alreadyRan: ExecutionSummary[] }>
  /** Auto path. Refuses (returns `refused`) when paused, high risk, safety, unclear or a locked action is enabled. */
  runAuto(
    ticketId: string,
  ): Promise<{ ran: boolean; refused?: string; executions?: ExecutionSummary[] }>
  /** Runs scheduled executions whose `scheduled_for` passed (Auto replies after the undo window). */
  runDueScheduled(): Promise<{ ran: number }>
}

// ---------------------------------------------------------------- autonomy + notify (IRDR-459)

export type AutonomyVerdict = 'auto' | 'ask'

export interface AutonomyService {
  /** Called by the agent after each successful run. `auto` only when every guard passes. */
  evaluate(ticketId: string): Promise<AutonomyVerdict>
}

export type NotifyKind = 'high_risk_ticket' | 'daily_digest' | 'system_alert'

export interface NotifyPayloads {
  high_risk_ticket: {
    ticketId: string
    displayNumber: number
    customerName: string | null
    customerEmail: string
    caseType: CaseType
    riskLevel: RiskLevel
    dueDate: string | null
    url: string
  }
  daily_digest: Record<string, never>
  system_alert: { title: string; detail: string; source: string }
}

export type NotifyFn = <K extends NotifyKind>(kind: K, payload: NotifyPayloads[K]) => Promise<void>

// ---------------------------------------------------------------- registry shape

export interface Services {
  jobs: JobsService
  mail: MailService
  agent: AgentService
  executor: ExecutorService
  autonomy: AutonomyService
  notify: NotifyFn
}

export type ServiceName = keyof Services
