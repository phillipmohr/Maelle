/**
 * Runs a fixture through the real agent code (loop, tools dispatch, finaliser, store) with the
 * memory store, fake tools and either the scripted model or a real one. Shared by the evals and
 * the unit tests.
 */
import type { ActionType } from '#shared/actions'
import type { MessageRow, ProposalRow, TicketRow } from '#shared/api'
import { EM_DASH_RE } from '#shared/proposal'
import { SEED_APP_ID } from '#shared/seed/data'
import { deterministicUuid } from '#shared/utils/ids'
import { createMemoryAttachmentStore } from '../server/agent/attachments/store'
import { agentRuntimeConfig, type AgentRuntimeConfig } from '../server/agent/config'
import { createKnowledgeLoader } from '../server/agent/knowledge/loader'
import { loadSnapshotKnowledge } from '../server/agent/knowledge/snapshot'
import { createScriptedModelClient, type ScriptedTurn } from '../server/agent/model/scripted'
import type { ModelClient } from '../server/agent/model/types'
import { runAgent, type AgentDeps, type AgentRunDetail } from '../server/agent/run'
import { createMemoryAgentStore, type MemoryAgentStore } from '../server/agent/store/memory'
import type { AgentStore } from '../server/agent/store/types'
import { createMemoryUsageSink, type MemoryUsageSink } from '../server/usage/memory'
import { SUBMIT_TOOL } from '../server/agent/tools/definitions'
import { createFakeTools, type FakeTools } from '../server/agent/tools'
import type { Expectation, Fixture, FixtureMessage, ScriptedSubmission } from './fixtures/types'
import { NOW, SUPPORT } from './fixtures/worlds'

export interface HarnessOptions {
  model?: ModelClient
  now?: Date
  log?: (msg: string, data?: unknown) => void
  config?: Partial<AgentRuntimeConfig>
  services?: AgentDeps['services']
}

export interface HarnessRun {
  fixture: Fixture
  store: MemoryAgentStore
  tools: FakeTools
  /** Every model call and tool call of the run (IRDR-460). */
  usage: MemoryUsageSink
  ticketId: string
  result: AgentRunDetail
  ticket: TicketRow
  proposal: ProposalRow | null
  durationMs: number
}

let displayNumber = 9000

export function fixtureTicketId(fixture: Fixture): string {
  return deterministicUuid(`fixture:${fixture.id}`)
}

export function messageRow(
  ticketId: string,
  ticket: Pick<TicketRow, 'customerEmail' | 'customerName' | 'subject'>,
  m: FixtureMessage,
  index: number,
): MessageRow {
  const inbound = m.direction === 'in'
  return {
    id: deterministicUuid(`${ticketId}:msg:${index}`),
    ticketId,
    direction: m.direction,
    fromEmail: inbound ? ticket.customerEmail : SUPPORT,
    fromName: inbound ? ticket.customerName : 'Anastasia · InstaRadar Support',
    toEmails: [inbound ? SUPPORT : ticket.customerEmail],
    subject: m.subject ?? (inbound && index === 0 ? ticket.subject : `Re: ${ticket.subject}`),
    textBody: m.text,
    htmlBody: null,
    translation: m.translation ?? null,
    attachments: [],
    receivedAt: inbound ? m.at : null,
    sentAt: inbound ? null : m.at,
    sentBy: inbound ? null : 'you',
    createdAt: m.at,
  }
}

export function ticketRow(fixture: Fixture, now: Date = NOW): TicketRow {
  const id = fixtureTicketId(fixture)
  const first = fixture.messages[0]?.at ?? now.toISOString()
  const last = fixture.messages[fixture.messages.length - 1]?.at ?? first
  return {
    id,
    appId: SEED_APP_ID,
    displayNumber: ++displayNumber,
    customerEmail: fixture.customer.email,
    customerName: fixture.customer.name,
    subject: fixture.subject,
    status: 'new',
    resolution: null,
    caseType: null,
    caseConfidence: null,
    riskLevel: 'none',
    riskReason: null,
    dueDate: null,
    stage: 1,
    waitingFor: null,
    snoozedUntil: null,
    tags: [],
    instaradarUserId: null,
    stripeCustomerId: null,
    customerContext: null,
    firstMessageAt: first,
    lastMessageAt: last,
    lastCustomerMessageAt: last,
    closedAt: null,
    createdAt: first,
    updatedAt: last,
  }
}

export function seedStore(
  fixture: Fixture,
  now: Date = NOW,
): { store: MemoryAgentStore; ticketId: string } {
  const ticket = ticketRow(fixture, now)
  const messages = fixture.messages.map((m, i) => messageRow(ticket.id, ticket, m, i))
  const tickets: TicketRow[] = [ticket]
  for (const [i, extra] of (fixture.extraTickets ?? []).entries()) {
    const id = deterministicUuid(`fixture:${fixture.id}:extra:${i}`)
    const t: TicketRow = {
      ...ticket,
      id,
      displayNumber: 4400 + i,
      customerEmail: extra.email,
      customerName: extra.name,
      subject: extra.subject,
      status: 'closed',
      resolution: 'approved',
      caseType: extra.caseType,
      caseConfidence: 0.9,
      firstMessageAt: extra.at,
      lastMessageAt: extra.at,
      lastCustomerMessageAt: extra.at,
      closedAt: extra.at,
      createdAt: extra.at,
      updatedAt: extra.at,
    }
    tickets.push(t)
    messages.push(messageRow(id, t, { direction: 'in', text: extra.text, at: extra.at }, 0))
    if (extra.replyText)
      messages.push(
        messageRow(
          id,
          t,
          {
            direction: 'out',
            text: extra.replyText,
            at: new Date(new Date(extra.at).getTime() + 3_600_000).toISOString(),
          },
          1,
        ),
      )
  }
  return { store: createMemoryAgentStore({ tickets, messages }), ticketId: ticket.id }
}

export function scriptedTurns(s: ScriptedSubmission): ScriptedTurn[] {
  const turns: ScriptedTurn[] = []
  if (s.research.length) turns.push({ toolCalls: s.research })
  turns.push({ toolCalls: [{ name: SUBMIT_TOOL, input: s.proposal }] })
  return turns
}

export function scriptedModel(s: ScriptedSubmission) {
  return createScriptedModelClient(scriptedTurns(s))
}

export function harnessDeps(
  fixture: Fixture,
  store: AgentStore,
  opts: HarnessOptions & { scripted?: ScriptedSubmission } = {},
): AgentDeps & { tools: FakeTools; usage: MemoryUsageSink } {
  const tools = createFakeTools(fixture.tools, fixture.toolOptions)
  const now = opts.now ?? NOW
  const config: AgentRuntimeConfig = {
    ...agentRuntimeConfig({} as NodeJS.ProcessEnv),
    sourceTimeoutMs: 5_000,
    ...opts.config,
  }
  return {
    store,
    tools,
    model: opts.model ?? scriptedModel(opts.scripted ?? fixture.scripted),
    knowledge: createKnowledgeLoader({
      notion: null,
      snapshot: () => loadSnapshotKnowledge({ knowledgeBase: fixture.knowledgeBase ?? [] }),
    }),
    attachments: createMemoryAttachmentStore(),
    config,
    services: opts.services ?? null,
    usage: createMemoryUsageSink(() => now),
    now: () => now,
    log: opts.log ?? (() => {}),
  }
}

export async function runFixture(fixture: Fixture, opts: HarnessOptions = {}): Promise<HarnessRun> {
  const { store, ticketId } = seedStore(fixture, opts.now)
  const deps = harnessDeps(fixture, store, opts)
  const started = Date.now()
  const result = await runAgent(deps, ticketId, fixture.trigger)
  const durationMs = Date.now() - started
  return {
    fixture,
    store,
    tools: deps.tools,
    usage: deps.usage,
    ticketId,
    result,
    ticket: (await store.getTicket(ticketId))!,
    proposal: await store.getLatestProposal(ticketId),
    durationMs,
  }
}

/**
 * Second run of a two-stage fixture: our stage-1 reply went out (the executor moved the ticket to
 * waiting_on_customer), the customer answers, the mail ticket moves it back to researching and
 * enqueues a customer_reply run.
 */
export async function runFollowUp(
  prev: HarnessRun,
  opts: HarnessOptions = {},
): Promise<HarnessRun> {
  const fixture = prev.fixture
  const follow = fixture.followUp
  if (!follow) throw new Error(`${fixture.id} has no followUp`)
  const now = opts.now ?? new Date(NOW.getTime() + 26 * 3_600_000)
  const ticket = (await prev.store.getTicket(prev.ticketId))!
  const replyBody = prev.proposal?.reply?.body ?? '(stage 1 reply)'
  const sentAt = new Date(NOW.getTime() + 3_600_000).toISOString()
  const n = prev.store.messages.filter((m) => m.ticketId === prev.ticketId).length
  prev.store.messages.push(
    messageRow(prev.ticketId, ticket, { direction: 'out', text: replyBody, at: sentAt }, n),
  )
  prev.store.messages.push(
    messageRow(
      prev.ticketId,
      ticket,
      { direction: 'in', text: follow.customerReply, at: now.toISOString() },
      n + 1,
    ),
  )
  ticket.status = 'waiting_on_customer'
  ticket.lastMessageAt = now.toISOString()
  ticket.lastCustomerMessageAt = now.toISOString()
  const deps = harnessDeps(fixture, prev.store, { ...opts, now, scripted: follow.scripted })
  const started = Date.now()
  const result = await runAgent(deps, prev.ticketId, 'customer_reply')
  return {
    fixture,
    store: prev.store,
    tools: deps.tools,
    usage: deps.usage,
    ticketId: prev.ticketId,
    result,
    ticket: (await prev.store.getTicket(prev.ticketId))!,
    proposal: await prev.store.getLatestProposal(prev.ticketId),
    durationMs: Date.now() - started,
  }
}

/** Returns the list of unmet expectations (empty when the proposal passes). */
export function checkExpectations(
  proposal: ProposalRow | null,
  ticket: TicketRow | null,
  exp: Expectation,
): string[] {
  const f: string[] = []
  if (!proposal) return ['no proposal was written']
  if (!exp.cases.includes(proposal.caseType))
    f.push(`case ${proposal.caseType}, expected ${exp.cases.join(' | ')}`)
  if (proposal.riskLevel !== exp.risk) f.push(`risk ${proposal.riskLevel}, expected ${exp.risk}`)
  const enabled = proposal.actions.filter((a) => a.enabled)
  const types = enabled.map((a) => a.type)
  const sameSet = (a: ActionType[], b: ActionType[]) =>
    a.length === b.length && a.every((x) => b.includes(x))
  if (exp.actions && !sameSet(types, exp.actions))
    f.push(`actions [${types.join(', ')}], expected [${exp.actions.join(', ')}]`)
  for (const t of exp.actionsMustInclude ?? [])
    if (!types.includes(t)) f.push(`missing action ${t}`)
  for (const t of exp.actionsMustExclude ?? [])
    if (types.includes(t)) f.push(`forbidden action ${t}`)
  if (proposal.stage !== exp.stage) f.push(`stage ${proposal.stage}, expected ${exp.stage}`)
  if (proposal.customerConfirmationNeeded !== exp.confirmationNeeded)
    f.push(
      `customerConfirmationNeeded ${proposal.customerConfirmationNeeded}, expected ${exp.confirmationNeeded}`,
    )
  if (exp.afterConfirmation) {
    for (const a of enabled) {
      const shouldWait = exp.afterConfirmation.includes(a.type)
      if (shouldWait && a.stage !== 'after_confirmation')
        f.push(`${a.type} should wait for confirmation`)
      if (!shouldWait && a.stage !== 'now') f.push(`${a.type} should run now`)
    }
  }
  for (const t of exp.requiredForReply ?? []) {
    const a = enabled.find((x) => x.type === t)
    if (!a?.requiredForReply) f.push(`${t} should be requiredForReply`)
  }
  if (exp.dueDate && !proposal.dueDate) f.push('expected a due date')
  if (exp.dueDateIs && proposal.dueDate !== exp.dueDateIs)
    f.push(`dueDate ${proposal.dueDate}, expected ${exp.dueDateIs}`)
  if (exp.attachment) {
    const att = proposal.reply?.attachments ?? []
    if (att.length === 0) f.push('expected an attachment on the reply')
    else if (!att.some((a) => /svg|png|pdf/.test(a.contentType ?? a.name)))
      f.push('attachment is not an image or PDF')
  }
  if (exp.noKnowledgeFound !== undefined && proposal.noKnowledgeFound !== exp.noKnowledgeFound)
    f.push(`noKnowledgeFound ${proposal.noKnowledgeFound}, expected ${exp.noKnowledgeFound}`)
  if (exp.linkedIssue) {
    const a = enabled.find((x) => x.type === 'create_linear_ticket')
    if (
      (a?.params as { existingIssueIdentifier?: string } | undefined)?.existingIssueIdentifier !==
      exp.linkedIssue
    )
      f.push(`create_linear_ticket should link ${exp.linkedIssue}`)
  }
  if (proposal.caseType !== 'unclear') {
    if (!proposal.reply) f.push('expected a reply draft')
    else {
      if (EM_DASH_RE.test(proposal.reply.body) || EM_DASH_RE.test(proposal.reply.subject))
        f.push('reply contains an em dash')
      for (const s of exp.replyContains ?? [])
        if (!proposal.reply.body.toLowerCase().includes(s.toLowerCase()))
          f.push(`reply should mention "${s}"`)
    }
  }
  if (ticket) {
    if (ticket.status !== 'needs_decision')
      f.push(`ticket status ${ticket.status}, expected needs_decision`)
    if (ticket.caseType !== proposal.caseType) f.push('ticket case differs from the proposal')
    if (ticket.stage !== proposal.stage) f.push('ticket stage differs from the proposal')
  }
  return f
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}
