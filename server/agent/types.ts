/**
 * Internal shapes of the agent. Every external system is normalised into these summaries by its
 * read client (real adapter or fake), so the research code, the prompt and the fixtures all speak
 * the same language.
 */
import type { AgentRunRow, MessageRow, SourceStatus, TicketRow } from '#shared/api'
import type { AgentTrigger } from '#shared/services'

export type ProgressSource = keyof NonNullable<AgentRunRow['progress']>
export type Progress = Partial<Record<ProgressSource, SourceStatus>>
export const PROGRESS_SOURCES: readonly ProgressSource[] = [
  'stripe',
  'supabase',
  'vercel',
  'kb',
  'linear',
  'email',
]

// ---------------------------------------------------------------- Stripe (read)

export interface StripeCustomerSummary {
  id: string
  email: string | null
  name: string | null
  /** ISO timestamp. */
  created: string
  currency: string | null
  card: { brand: string; last4: string } | null
  /** Stripe dashboard link. */
  url: string
}

export interface StripeSubscriptionSummary {
  id: string
  status: string
  /** Product / price nickname, e.g. "Pro Monthly". */
  plan: string
  interval: 'day' | 'week' | 'month' | 'year' | null
  amountCents: number | null
  currency: string
  created: string
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  canceledAt: string | null
  endedAt: string | null
  cancellationReason: string | null
}

export interface StripeInvoiceSummary {
  id: string
  status: string | null
  amountDueCents: number
  amountPaidCents: number
  currency: string
  created: string
  paidAt: string | null
  attemptCount: number
  nextPaymentAttempt: string | null
  subscriptionId: string | null
  billingReason: string | null
}

export interface StripeChargeSummary {
  id: string
  paymentIntentId: string | null
  invoiceId: string | null
  amountCents: number
  amountRefundedCents: number
  currency: string
  status: 'succeeded' | 'pending' | 'failed'
  created: string
  card: { brand: string; last4: string } | null
  disputed: boolean
  failureMessage: string | null
  description: string | null
}

export interface StripeRefundSummary {
  id: string
  chargeId: string
  paymentIntentId: string | null
  amountCents: number
  currency: string
  status: string | null
  reason: string | null
  created: string
}

export interface StripeDisputeSummary {
  id: string
  chargeId: string
  amountCents: number
  currency: string
  status: string
  reason: string | null
  created: string
  /** Deadline to submit evidence (ISO date) when Stripe knows one. */
  evidenceDueBy: string | null
}

export interface StripeEventSummary {
  id: string
  type: string
  created: string
  objectId: string | null
  summary: string
}

export interface StripeCustomerBundle {
  customer: StripeCustomerSummary | null
  /** Other customers with the same email, if any (duplicate accounts). */
  otherCustomers: StripeCustomerSummary[]
  subscriptions: StripeSubscriptionSummary[]
  invoices: StripeInvoiceSummary[]
  charges: StripeChargeSummary[]
  refunds: StripeRefundSummary[]
  disputes: StripeDisputeSummary[]
  events: StripeEventSummary[]
}

export interface StripeReadClient {
  readonly configured: boolean
  findCustomersByEmail(email: string): Promise<StripeCustomerSummary[]>
  /** Stripe search by name or email fragment (a bank names the cardholder, not the account email). */
  searchCustomers(query: string): Promise<StripeCustomerSummary[]>
  getCustomer(customerId: string): Promise<StripeCustomerSummary | null>
  listSubscriptions(customerId: string): Promise<StripeSubscriptionSummary[]>
  listInvoices(customerId: string): Promise<StripeInvoiceSummary[]>
  listCharges(customerId: string): Promise<StripeChargeSummary[]>
  listRefunds(customerId: string): Promise<StripeRefundSummary[]>
  listDisputes(customerId: string): Promise<StripeDisputeSummary[]>
  /** Events of the last `days` days that concern the customer (subscriptions, charges, invoices, disputes). */
  listEvents(customerId: string, days: number): Promise<StripeEventSummary[]>
  /** Ad-hoc retrieve by id prefix (cus_, sub_, in_, ch_, pi_, re_, dp_). Read-only. */
  retrieve(id: string): Promise<unknown>
}

// ---------------------------------------------------------------- InstaRadar database (read)

export interface InstaradarUser {
  id: string
  email: string
  plan: string | null
  status: string | null
  createdAt: string
  stripeCustomerId: string | null
  lastSignInAt: string | null
}

export interface InstaradarTrackedProfile {
  id: string
  handle: string
  since: string
  active: boolean
}

export interface InstaradarSignIn {
  at: string
  action: string | null
}

export interface InstaradarScan {
  at: string
  handle: string | null
  status: string | null
  error: string | null
}

export interface InstaradarAlert {
  at: string
  handle: string | null
  type: string | null
}

export interface InstaradarProfileLookup {
  handle: string
  trackedByUsers: number
  blocked: boolean
}

export interface SelectResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowCount: number
  truncated: boolean
}

export interface InstaradarReadClient {
  readonly configured: boolean
  findUserByEmail(email: string): Promise<InstaradarUser | null>
  listTrackedProfiles(userId: string): Promise<InstaradarTrackedProfile[]>
  listSignIns(userId: string, days: number): Promise<InstaradarSignIn[]>
  listScans(userId: string, days: number): Promise<InstaradarScan[]>
  listAlerts(userId: string, days: number): Promise<InstaradarAlert[]>
  lookupProfile(handle: string): Promise<InstaradarProfileLookup | null>
  /** Guarded ad-hoc SELECT (single statement, LIMIT forced, statement timeout). */
  select(sql: string): Promise<SelectResult>
}

export interface InstaradarBundle {
  user: InstaradarUser | null
  trackedProfiles: InstaradarTrackedProfile[]
  signIns: InstaradarSignIn[]
  scans: InstaradarScan[]
  alerts: InstaradarAlert[]
  /** Profiles mentioned in the thread (@handles), looked up regardless of the account. */
  mentionedProfiles: InstaradarProfileLookup[]
}

// ---------------------------------------------------------------- Vercel logs (read)

export interface LogLine {
  at: string
  level: 'error' | 'warning' | 'info' | 'debug'
  /** Function / route name, e.g. "scan-worker". */
  source: string | null
  message: string
  requestId: string | null
}

export interface LogQuery {
  since: string
  until?: string
  text?: string
  userId?: string
  handle?: string
  level?: 'error' | 'warning' | 'all'
  limit?: number
}

export interface VercelLogsClient {
  readonly configured: boolean
  search(query: LogQuery): Promise<LogLine[]>
}

// ---------------------------------------------------------------- Linear (read)

export interface LinearIssueSummary {
  id: string
  identifier: string
  title: string
  description: string | null
  state: string
  stateType: string | null
  url: string
  labels: string[]
  createdAt: string
  updatedAt: string
}

export interface LinearReadClient {
  readonly configured: boolean
  searchIssues(query: string, opts?: { includeClosed?: boolean }): Promise<LinearIssueSummary[]>
  getIssue(identifier: string): Promise<LinearIssueSummary | null>
}

// ---------------------------------------------------------------- Notion (read)

export interface NotionPropertyMap {
  [name: string]: unknown
}

export interface NotionRow {
  id: string
  url: string
  properties: NotionPropertyMap
}

export interface NotionReadClient {
  readonly configured: boolean
  /** All rows of a data source (collection). */
  queryDataSource(dataSourceId: string): Promise<NotionRow[]>
  /** Page body as plain text (paragraphs, lists, headings). */
  getPageText(pageId: string): Promise<string>
}

// ---------------------------------------------------------------- Email history (Maelle's DB)

export interface PreviousTicketSummary {
  id: string
  displayNumber: number
  subject: string | null
  status: string
  caseType: string | null
  resolution: string | null
  createdAt: string
  closedAt: string | null
  messages: { direction: 'in' | 'out'; at: string; excerpt: string }[]
}

// ---------------------------------------------------------------- research bundle

export interface SourceOutcome<T> {
  status: SourceStatus
  data: T | null
  /** Human readable warning, e.g. "Vercel logs unavailable". */
  warning: string | null
  durationMs: number
}

export interface ResearchBundle {
  stripe: SourceOutcome<StripeCustomerBundle>
  supabase: SourceOutcome<InstaradarBundle>
  vercel: SourceOutcome<LogLine[]>
  linear: SourceOutcome<LinearIssueSummary[]>
  email: SourceOutcome<PreviousTicketSummary[]>
}

export type ConfirmationSignal = 'confirmed' | 'declined' | 'none'

/** Everything the run knows before the model starts. */
export interface RunInput {
  ticket: TicketRow
  messages: MessageRow[]
  trigger: AgentTrigger
  now: Date
}
