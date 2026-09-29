/**
 * API route list with request and response types. Handlers are stubbed with seed data in
 * `server/api/**` and owned by the tickets named here. Route paths and payload shapes are binding;
 * owners may add fields (additive only).
 */
import type { ActionStage, ActionType } from './actions'
import type { CaseType, RiskLevel } from './case-types'
import type { Proposal, ReplyDraft, ResearchItem, KnowledgeRef, CandidateCase } from './proposal'
import type {
  AgentTrigger,
  ApproveInput,
  ApproveResult,
  ExecutionSummary,
  RejectReason,
} from './services'
import type { TicketResolution, TicketStatus } from './status'

// ---------------------------------------------------------------- shared row shapes (camelCase views of the tables)

export type ExecutedBy = 'you' | 'auto'
export type ExecutionStatus =
  'queued' | 'scheduled' | 'running' | 'succeeded' | 'failed' | 'held' | 'cancelled'
export type SourceStatus = 'pending' | 'ok' | 'failed' | 'skipped'
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type DecisionKind =
  | 'approved'
  | 'approved_with_edits'
  | 'rejected'
  | 'handled_manually'
  | 'snoozed'
  | 'marked_done'
  | 'auto'

export interface CustomerContextTimelineEntry {
  date: string
  label: string
  amount: string | null
  kind: 'default' | 'bad' | 'muted'
}

/** Deterministic snapshot for the context panel (built by code in the agent ticket). */
export interface CustomerContext {
  title: string
  plan: { label: string; value: string; mono?: boolean }[]
  timeline: CustomerContextTimelineEntry[]
  trackedProfiles: { handle: string; meta: string }[]
  previousTickets: { id: string; displayNumber: number; title: string; date: string }[]
  logErrors: { text: string; count: number }[] | null
  logErrorsNote: string | null
  tags: string[]
}

export interface TicketRow {
  id: string
  appId: string
  displayNumber: number
  customerEmail: string
  customerName: string | null
  subject: string | null
  status: TicketStatus
  resolution: TicketResolution | null
  caseType: CaseType | null
  caseConfidence: number | null
  riskLevel: RiskLevel
  riskReason: string | null
  dueDate: string | null
  stage: 1 | 2
  /** Full sentence written by the executor, e.g. 'Waiting for “Yes, refund”'. Shown verbatim. */
  waitingFor: string | null
  snoozedUntil: string | null
  tags: string[]
  instaradarUserId: string | null
  stripeCustomerId: string | null
  customerContext: CustomerContext | null
  firstMessageAt: string | null
  lastMessageAt: string | null
  lastCustomerMessageAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
  /** Set when the ticket came from the mailbox history import (IRDR-455): closed on arrival, no agent run. */
  importedAt?: string | null
}

export interface MessageRow {
  id: string
  ticketId: string
  direction: 'in' | 'out'
  fromEmail: string
  fromName: string | null
  toEmails: string[]
  subject: string | null
  textBody: string | null
  /** text_body with the quoted history removed (IRDR-455); null when the mail had no quote or the row predates the column. Prefer it for display. */
  textStripped?: string | null
  htmlBody: string | null
  translation: string | null
  attachments: { name: string; storagePath: string; contentType?: string; sizeBytes?: number }[]
  receivedAt: string | null
  sentAt: string | null
  sentBy: ExecutedBy | null
  createdAt: string
}

export interface AgentRunRow {
  id: string
  ticketId: string
  trigger: AgentTrigger
  status: RunStatus
  progress: Partial<
    Record<'stripe' | 'supabase' | 'vercel' | 'kb' | 'linear' | 'email', SourceStatus>
  >
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  model: string | null
  error: string | null
  proposalId: string | null
  createdAt: string
}

export interface ProposedActionRow {
  id: string
  proposalId: string
  position: number
  type: ActionType
  params: Record<string, unknown>
  reason: string
  stage: ActionStage
  requiredForReply: boolean
  enabled: boolean
}

export interface ProposalRow {
  id: string
  ticketId: string
  runId: string | null
  version: number
  caseType: CaseType
  confidence: number | null
  candidateCases: CandidateCase[]
  summaryLine: string
  metaLine: string | null
  riskLevel: RiskLevel
  riskReason: string | null
  dueDate: string | null
  customerConfirmationNeeded: boolean
  stage: 1 | 2
  research: ResearchItem[]
  researchWarnings: string[]
  policyWarnings: string[]
  conclusion: string | null
  reply: ReplyDraft | null
  knowledgeRefs: KnowledgeRef[]
  noKnowledgeFound: boolean
  status: 'active' | 'superseded' | 'decided'
  createdAt: string
  actions: ProposedActionRow[]
}

export interface ActionExecutionRow {
  id: string
  ticketId: string
  proposalId: string | null
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
}

export interface DecisionRow {
  id: string
  ticketId: string
  proposalId: string | null
  decision: DecisionKind
  rejectReason: RejectReason | null
  note: string | null
  replyDiff: unknown
  actionChanges: unknown
  timeToDecideMs: number | null
  decidedAt: string
}

// ---------------------------------------------------------------- GET /api/me (foundation)

export interface MeResponse {
  email: string
  authDisabled: boolean
}

// ---------------------------------------------------------------- GET /api/tickets (UI ticket IRDR-458; stub: foundation)

export interface TicketListQuery {
  /** Comma separated statuses; default: everything that is not closed. */
  status?: string
  /** Free text over name, email, subject, display number. */
  q?: string
  caseType?: CaseType
  resolution?: TicketResolution
  /** Closed tickets only: ISO date range. */
  from?: string
  to?: string
  cursor?: string
  limit?: number
}

export interface TicketListItem extends TicketRow {
  /** Active proposal summary line, or null while researching. */
  proposalLine: string | null
  actionCount: number
  /** Live research checklist while researching. */
  runProgress: AgentRunRow['progress'] | null
  /** Human summary of what ran (closed tickets). */
  whatRan: string | null
  decision: DecisionKind | null
  decisionNote: string | null
}

export interface TicketListResponse {
  items: TicketListItem[]
  nextCursor: string | null
  counts: {
    needsDecision: number
    waitingOnCustomer: number
    snoozed: number
    autoPending: number
    closedLast3Days: number
    closedToday: number
  }
  /** `status=closed` only: closed tickets per case under the same resolution and date filters (IRDR-455). */
  caseCounts?: Partial<Record<CaseType, number>>
}

// ---------------------------------------------------------------- GET /api/tickets/:id (UI ticket; stub: foundation)

export interface TicketDetailResponse {
  ticket: TicketRow
  messages: MessageRow[]
  proposal: ProposalRow | null
  previousProposals: Pick<ProposalRow, 'id' | 'version' | 'status' | 'createdAt'>[]
  executions: ActionExecutionRow[]
  decisions: DecisionRow[]
  runs: AgentRunRow[]
}

// ---------------------------------------------------------------- Decision API (executor ticket IRDR-457)

export type ApproveRequest = ApproveInput
export type ApproveResponse = ApproveResult
/** 409 body when an enabled irreversible action lacks confirmIrreversible. */
export interface ConfirmRequiredResponse {
  error: 'confirm_required'
  irreversible: { position: number; type: ActionType; effect: string }[]
}
export interface RejectRequest {
  reason: RejectReason
  note?: string
}
export interface ManualSendRequest {
  reply: Pick<ReplyDraft, 'to' | 'subject' | 'body'>
  actions: { type: ActionType; params: Record<string, unknown> }[]
  handledManually: boolean
}
export interface SnoozeRequest {
  until: string
}
export interface MarkDoneRequest {
  note: string
}
export interface SetCaseRequest {
  caseType: CaseType
}
export interface UndoResponse {
  cancelled: ExecutionSummary[]
  alreadyRan: ExecutionSummary[]
}
export interface RerunRequest {
  trigger?: Extract<AgentTrigger, 'rerun' | 'case_override'>
}

// ---------------------------------------------------------------- POST /api/agent/consistency-check (agent ticket IRDR-456)

export interface ConsistencyCheckRequest {
  ticketId: string
  replyBody: string
  enabledActions: { type: ActionType; params: Record<string, unknown> }[]
}
export interface ConsistencyCheckResponse {
  mismatches: { severity: 'warning' | 'error'; text: string }[]
}

// ---------------------------------------------------------------- Activity log (autonomy ticket IRDR-459)

export interface ActivityQuery {
  by?: ExecutedBy
  irreversibleOnly?: boolean
  from?: string
  to?: string
  cursor?: string
  limit?: number
}
export interface ActivityItem extends ActionExecutionRow {
  ticketDisplayNumber: number
  customerName: string | null
}
export interface ActivityResponse {
  items: ActivityItem[]
  nextCursor: string | null
}

// ---------------------------------------------------------------- Autonomy (autonomy ticket IRDR-459)

export type AutonomyMode = 'always_ask' | 'auto'

export interface CaseTrackRecord {
  caseType: CaseType
  typicalActions: ActionType[]
  /** Last 30 decisions, newest last: 'unchanged' | 'edited' | 'rejected'. */
  ticks: ('unchanged' | 'edited' | 'rejected')[]
  total: number
  unchanged: number
  edited: number
  rejected: number
  recommendation: string
  recommendationKind: 'ready' | 'collecting' | 'keep_asking' | 'on_auto'
  mode: AutonomyMode
  autoSince: string | null
  undos: number
}

export interface SettingsRow {
  appId: string
  globalPause: boolean
  undoWindowMinutes: 5 | 10 | 15
  digestTime: string
  timezone: string
  followUpDays: number
  autoCloseDays: number
  refundDailyLimitCount: number
  refundDailyLimitAmountCents: number
  notifyEmail: string | null
}

export interface AutonomyResponse {
  settings: SettingsRow
  cases: CaseTrackRecord[]
  locks: { type: ActionType; locked: boolean; lockable: boolean }[]
  onAutoCount: number
  alwaysAskCount: number
}

export interface AutonomyUpdateRequest {
  modes?: Partial<Record<CaseType, AutonomyMode>>
  locks?: Partial<Record<ActionType, boolean>>
  settings?: Partial<Omit<SettingsRow, 'appId'>>
}

// ---------------------------------------------------------------- Playbook (autonomy ticket IRDR-459)

export interface PlaybookResponse {
  protocol: { title: string; url: string }[]
  templates: {
    caseType: CaseType
    label: string
    actions: ActionType[]
    requiresConfirmation: boolean
    url: string
  }[]
  examples: { count: number; url: string }
  knowledgeBase: { active: number; draft: number; url: string }
}

// ---------------------------------------------------------------- Learning (autonomy ticket IRDR-459)

export interface LearningExampleRequest {
  ticketId: string
}
export interface LearningKbDraftRequest {
  ticketId: string
}
export interface LearningResponse {
  notionPageId: string
  url: string
}

// ---------------------------------------------------------------- Mail, jobs, webhooks (mail ticket IRDR-455)

export interface LinearWebhookAck {
  ok: true
  created: number
  skipped: number
}
export interface CronAck {
  ok: true
  job: string
  ran: number
}

// ---------------------------------------------------------------- Route table

export type RouteOwner = 'IRDR-454' | 'IRDR-455' | 'IRDR-456' | 'IRDR-457' | 'IRDR-458' | 'IRDR-459'

export interface RouteSpec {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  owner: RouteOwner
  auth: 'session' | 'cron_secret' | 'signature'
}

export const ROUTES: readonly RouteSpec[] = [
  { method: 'GET', path: '/api/health', owner: 'IRDR-454', auth: 'session' },
  { method: 'GET', path: '/api/me', owner: 'IRDR-454', auth: 'session' },
  { method: 'GET', path: '/api/tickets', owner: 'IRDR-458', auth: 'session' },
  { method: 'GET', path: '/api/tickets/:id', owner: 'IRDR-458', auth: 'session' },
  { method: 'POST', path: '/api/tickets/:id/approve', owner: 'IRDR-457', auth: 'session' },
  { method: 'POST', path: '/api/tickets/:id/reject', owner: 'IRDR-457', auth: 'session' },
  { method: 'POST', path: '/api/tickets/:id/manual-send', owner: 'IRDR-457', auth: 'session' },
  { method: 'POST', path: '/api/tickets/:id/snooze', owner: 'IRDR-457', auth: 'session' },
  { method: 'POST', path: '/api/tickets/:id/unsnooze', owner: 'IRDR-457', auth: 'session' },
  { method: 'POST', path: '/api/tickets/:id/retry', owner: 'IRDR-457', auth: 'session' },
  { method: 'POST', path: '/api/tickets/:id/mark-done', owner: 'IRDR-457', auth: 'session' },
  { method: 'POST', path: '/api/tickets/:id/case', owner: 'IRDR-457', auth: 'session' },
  { method: 'POST', path: '/api/tickets/:id/undo', owner: 'IRDR-457', auth: 'session' },
  { method: 'POST', path: '/api/tickets/:id/rerun', owner: 'IRDR-456', auth: 'session' },
  { method: 'POST', path: '/api/agent/consistency-check', owner: 'IRDR-456', auth: 'session' },
  { method: 'GET', path: '/api/activity', owner: 'IRDR-459', auth: 'session' },
  { method: 'GET', path: '/api/activity/export.csv', owner: 'IRDR-459', auth: 'session' },
  { method: 'GET', path: '/api/autonomy', owner: 'IRDR-459', auth: 'session' },
  { method: 'PUT', path: '/api/autonomy', owner: 'IRDR-459', auth: 'session' },
  { method: 'GET', path: '/api/playbook', owner: 'IRDR-459', auth: 'session' },
  { method: 'POST', path: '/api/learning/example', owner: 'IRDR-459', auth: 'session' },
  { method: 'POST', path: '/api/learning/kb-draft', owner: 'IRDR-459', auth: 'session' },
  { method: 'POST', path: '/api/webhooks/linear', owner: 'IRDR-455', auth: 'signature' },
  { method: 'POST', path: '/api/cron/tick', owner: 'IRDR-455', auth: 'cron_secret' },
  { method: 'POST', path: '/api/cron/fetch-mail', owner: 'IRDR-455', auth: 'cron_secret' },
  { method: 'GET', path: '/api/mail/status', owner: 'IRDR-455', auth: 'session' },
  { method: 'POST', path: '/api/mail/fetch', owner: 'IRDR-455', auth: 'session' },
  { method: 'POST', path: '/api/mail/import', owner: 'IRDR-455', auth: 'session' },
  { method: 'POST', path: '/api/mail/classify-imported', owner: 'IRDR-455', auth: 'session' },
]

/** Proposal shape as the agent produces it, re-exported for API consumers. */
export type { Proposal }

// ---------------------------------------------------------------- IRDR-459 additions (appended; interface merges add optional fields only)

export type SettingsAuditScope = 'setting' | 'mode' | 'lock'

/** One row of `settings_audit`: who changed what, from which value to which. */
export interface SettingsAuditItem {
  id: string
  createdAt: string
  changedBy: string
  scope: SettingsAuditScope
  key: string
  oldValue: unknown
  newValue: unknown
  /** "Cancellation only: Always ask → Auto" */
  summary: string
}

export interface ActivityResponse {
  /** Settings changes in the same time range as `items`, shown as "Settings" entries. */
  settings?: SettingsAuditItem[]
}

export interface ActivityQuery {
  /** Default true for All / You; never with `by=auto` or `irreversibleOnly`. */
  includeSettings?: boolean
}

export interface PlaybookResponse {
  /** True when the counts were read from Notion (NOTION_TOKEN), false for the snapshot. */
  liveCounts?: boolean
  examplesStatus?: { active: number; draft: number }
}

export interface LearningResponse {
  /** True when the page had already been created for this ticket and kind (idempotent). */
  existing?: boolean
  /** 'notion' through the Notion API, 'fake' when NOTION_TOKEN is missing. */
  writer?: 'notion' | 'fake'
}

export interface AutonomyResponse {
  /** After PUT: the audit rows this request wrote (empty when nothing changed). */
  changes?: SettingsAuditItem[]
}

// ---------------------------------------------------------------- IRDR-455 additions: mailbox status and history import

export type MailBackfillFolder = 'inbox' | 'sent'
export type MailBackfillStatus = 'queued' | 'running' | 'done' | 'failed'

/** One row of `mail_backfills`: the import cursor and counters of one folder. */
export interface MailBackfillProgress {
  folder: MailBackfillFolder
  status: MailBackfillStatus
  /** Last UID handled and the highest UID in the folder when the import started (null before the first chunk). */
  lastUid: number | null
  maxUid: number | null
  listed: number
  imported: number
  /** Already known (dedupe by Message-ID or provider id). */
  skipped: number
  /** Auto-replies, bounces, bulk, own mail in INBOX, mail to ourselves in Sent. */
  ignored: number
  failed: number
  ticketsCreated: number
  lastError: string | null
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

/** The classify-only pass over imported tickets. */
export interface MailClassifyProgress {
  /** Imported tickets in total, with a case, still waiting, and given up on. */
  imported: number
  classified: number
  pending: number
  failed: number
  /** A chunk job is queued, retrying or running. */
  active: boolean
  /** Why nothing is scheduled although tickets wait (no ANTHROPIC_API_KEY). */
  blocked: string | null
  lastError: string | null
}

export interface MailStatusResponse {
  provider: 'imap' | 'fake'
  mailbox: string
  /** Live fetch: when it last ran, its summary (mail_cursors.last_result) and whether a run is pending. */
  fetch: {
    lastAt: string | null
    lastResult: Record<string, unknown> | null
    active: boolean
  }
  backfill: {
    folders: MailBackfillProgress[]
    active: boolean
  }
  classify: MailClassifyProgress
  /** Closed tickets per case, imported and live together (for the "what do people write about" view). */
  caseCounts: Partial<Record<CaseType, number>>
}

export interface MailFetchResponse {
  ok: true
  fetched: number
  ingested: number
  skipped: number
  ignored: number
  failed: number
  ticketsCreated: number
}

export interface MailImportResponse {
  ok: true
  /** False when an import was already running or queued (nothing was changed). */
  started: boolean
  status: MailStatusResponse
}

export interface MailClassifyImportedResponse {
  ok: true
  /** False when nothing waits, a chunk is already pending, or the model key is missing (`reason` says which). */
  started: boolean
  reason: string | null
  status: MailStatusResponse
}
