/**
 * Fixture shapes shared by the plumbing eval (scripted model), the live eval (real model) and the
 * unit tests. A fixture is a ticket, the fake data every read tool answers with, what a competent
 * model would submit (for the scripted run) and what the proposal must look like.
 */
import type { ActionType } from '#shared/actions'
import type { CaseType, RiskLevel } from '#shared/case-types'
import type { ProposalInput } from '#shared/proposal'
import type { AgentTrigger } from '#shared/services'
import type { KnowledgeBaseEntry } from '../../server/agent/knowledge/types'
import type { Translation } from '../../server/agent/tools/definitions'
import type { FakeToolsData, FakeToolsOptions } from '../../server/agent/tools'

export interface FixtureMessage {
  direction: 'in' | 'out'
  text: string
  /** ISO timestamp. */
  at: string
  subject?: string
  translation?: string
}

export interface ExtraTicket {
  email: string
  name: string | null
  subject: string
  text: string
  at: string
  caseType: CaseType
  replyText?: string
}

export interface Expectation {
  /** Accepted cases (the first is the preferred one). */
  cases: CaseType[]
  risk: RiskLevel
  /** Exact set of enabled action types, order-insensitive. */
  actions?: ActionType[]
  actionsMustInclude?: ActionType[]
  actionsMustExclude?: ActionType[]
  stage: 1 | 2
  confirmationNeeded: boolean
  /** These actions wait for the customer; every other action runs now. */
  afterConfirmation?: ActionType[]
  requiredForReply?: ActionType[]
  dueDate?: boolean
  /** Exact due date when the deadline is stated in the message. */
  dueDateIs?: string
  attachment?: boolean
  noKnowledgeFound?: boolean
  /** create_linear_ticket must link this existing issue. */
  linkedIssue?: string
  /** The reply body must contain each of these (case-insensitive). */
  replyContains?: string[]
}

export interface ScriptedSubmission {
  /** Research tool calls the scripted model makes before submitting (one parallel turn). */
  research: { name: string; input: unknown }[]
  proposal: ProposalInput & { translations?: Translation[] }
}

export interface Fixture {
  id: string
  title: string
  group: 'case' | 'example'
  customer: { email: string; name: string | null }
  subject: string
  messages: FixtureMessage[]
  trigger: AgentTrigger
  tools: FakeToolsData
  toolOptions?: FakeToolsOptions
  knowledgeBase?: KnowledgeBaseEntry[]
  /** Other tickets of the same customers (email history). */
  extraTickets?: ExtraTicket[]
  scripted: ScriptedSubmission
  expect: Expectation
  /** Second run of a two-stage case: the customer answers our stage-1 reply. */
  followUp?: {
    customerReply: string
    scripted: ScriptedSubmission
    expect: Expectation
  }
}
