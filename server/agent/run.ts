/**
 * One agent run: status transition, research with live progress, the model loop, deterministic
 * finalisation, the write path, the autonomy hand-off. `agent.run(ticketId, trigger)` from
 * shared/services is implemented here.
 */
import type { MessageRow, TicketRow } from '#shared/api'
import type { CaseType } from '#shared/case-types'
import { AGENT } from '#shared/config'
import type { AgentRunResult, AgentTrigger, Services } from '#shared/services'
import { canTransition, transition, type TicketStatus } from '#shared/status'
import type { AttachmentStore } from './attachments/store'
import type { AgentRuntimeConfig } from './config'
import { buildCustomerContext, deriveFacts } from './context'
import { finalizeSubmission } from './finalize'
import type { KnowledgeLoader } from './knowledge/loader'
import { AgentLoopError, runToolLoop, type LoopUsage } from './loop'
import type { ModelClient } from './model/types'
import { buildSystemPrompt, buildUserMessage } from './prompt'
import { candidateEmailsFor, gatherResearch } from './research'
import type { AgentStore } from './store/types'
import { allToolDefinitions } from './tools/definitions'
import type { AgentTools } from './tools'
import { detectConfirmation } from './two-stage'
import type { LinearIssueSummary, Progress, ProgressSource } from './types'
import { createMemoryAttachmentStore } from './attachments/store'
import type { UsageSink } from '../usage/types'

export interface AgentDeps {
  store: AgentStore
  tools: AgentTools
  model: ModelClient
  knowledge: KnowledgeLoader
  attachments: AttachmentStore
  config: AgentRuntimeConfig
  /** Autonomy + executor hand-off after a successful run; null in unit tests. */
  services: Pick<Services, 'autonomy' | 'executor'> | null
  /** Per-call and per-tool token rows (IRDR-460); null records nothing. */
  usage?: UsageSink | null
  now?: () => Date
  log?: (msg: string, data?: unknown) => void
}

export interface RunOptions {
  jobId?: string | null
  attempt?: number
}

export interface AgentRunDetail extends AgentRunResult {
  version?: number
  durationMs: number
  progress: Progress
  notes?: string[]
}

const STARTABLE: readonly TicketStatus[] = [
  'new',
  'needs_decision',
  'waiting_on_customer',
  'snoozed',
  'closed',
  'researching',
]

export async function runAgent(
  deps: AgentDeps,
  ticketId: string,
  trigger: AgentTrigger,
  opts: RunOptions = {},
): Promise<AgentRunDetail> {
  const now = deps.now?.() ?? new Date()
  const startedAt = Date.now()
  const log = deps.log ?? (() => {})
  const { store, config } = deps
  const progress: Progress = {}
  /** Running loop totals, so a failed run still records what it spent. */
  let loopUsage: LoopUsage | null = null

  const ticket = await store.getTicket(ticketId)
  if (!ticket)
    return {
      runId: '',
      status: 'failed',
      retryable: false,
      error: `Ticket ${ticketId} not found`,
      durationMs: 0,
      progress,
    }

  const start = await store.beginRun(ticketId, trigger, config.model, opts.jobId ?? null)
  if (start.reused === 'succeeded')
    return {
      runId: start.runId,
      status: 'succeeded',
      proposalId: start.proposalId ?? undefined,
      durationMs: 0,
      progress,
    }
  if (start.reused === 'running')
    return {
      runId: start.runId,
      status: 'failed',
      retryable: false,
      error: 'A run for this job is already in progress',
      durationMs: 0,
      progress,
    }
  const runId = start.runId

  // Status at run start: new → researching, needs_decision → researching (rerun, case override);
  // waiting_on_customer / snoozed / closed → researching when the mail ticket did not do it yet.
  const status = ticket.status
  if (
    !STARTABLE.includes(status) ||
    (status !== 'researching' && !canTransition(status, 'researching'))
  ) {
    const error = `Cannot run the agent while the ticket is ${status}`
    await store.finishRun(runId, { status: 'failed', error, durationMs: Date.now() - startedAt })
    return {
      runId,
      status: 'failed',
      retryable: false,
      error,
      durationMs: Date.now() - startedAt,
      progress,
    }
  }
  if (status !== 'researching')
    await store.setTicketStatus(ticketId, status, transition(status, 'researching'))

  const persistProgress = async (p: Progress) => {
    Object.assign(progress, p)
    await store
      .updateRunProgress(runId, { ...progress })
      .catch((e) => log('progress update failed', e))
  }

  let contextPatch: {
    customerContext: TicketRow['customerContext']
    tags: string[] | null
    instaradarUserId: string | null
    stripeCustomerId: string | null
  } = {
    customerContext: null,
    tags: null,
    instaradarUserId: null,
    stripeCustomerId: null,
  }

  try {
    const messages = await store.getMessages(ticketId)
    // A regenerate exists because instructions or settings changed: read Notion fresh enough.
    const knowledgeP = deps.knowledge.load(
      trigger === 'rerun' ? { maxAgeMs: AGENT.rerunKnowledgeMaxAgeMs } : undefined,
    )
    const emailHistory = async (emails: string[]) => {
      const lists = await Promise.all(emails.map((e) => store.getPreviousTickets(e, ticketId)))
      const seen = new Set<string>()
      return lists.flat().filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
    }
    const candidateEmails = candidateEmailsFor(ticket, messages)
    const research = await gatherResearch({
      ticket,
      messages,
      tools: deps.tools,
      emailHistory,
      timeoutMs: config.sourceTimeoutMs,
      now,
      onProgress: persistProgress,
    })
    const knowledge = await knowledgeP
    await persistProgress({ kb: 'ok' })
    const researchWarnings = [...research.warnings]
    if (knowledge.source === 'snapshot' && knowledge.warnings.length)
      researchWarnings.push(
        knowledge.warnings.find((w) => /Notion unavailable|NOTION_TOKEN/.test(w)) ??
          knowledge.warnings[0]!,
      )

    const facts = deriveFacts(ticket, research.bundle, now)
    const previousTickets = (research.bundle.email.data ?? []).map((t) => ({
      id: t.id,
      displayNumber: t.displayNumber,
      title: t.subject ?? '(no subject)',
      date: t.createdAt.slice(0, 10),
    }))
    const customerContext = buildCustomerContext(facts, research.bundle, now, {
      customerName: facts.customerName,
      previousTickets,
    })
    contextPatch = {
      customerContext,
      tags: facts.tags,
      instaradarUserId: facts.instaradarUserId,
      stripeCustomerId: facts.stripeCustomerId,
    }

    const confirmation = detectConfirmation(messages)
    const caseOverride: CaseType | null = trigger === 'case_override' ? ticket.caseType : null
    const previousProposal = await store.getLatestProposal(ticketId)

    let release: {
      issue: LinearIssueSummary | null
      identifier: string
      originalThread: MessageRow[]
    } | null = null
    if (trigger === 'release_notification') {
      const ref = await store.getReleaseNotificationForTicket(ticketId)
      if (!ref)
        throw new Error(
          'release_notification run without a release_notifications row for this ticket',
        )
      const issue = deps.tools.linear.configured
        ? await deps.tools.linear.getIssue(ref.linearIssueIdentifier).catch(() => null)
        : null
      if (!issue)
        researchWarnings.push(`Linear issue ${ref.linearIssueIdentifier} could not be loaded`)
      const originalThread = ref.originalTicketId
        ? await store.getMessages(ref.originalTicketId)
        : []
      release = { issue, identifier: ref.linearIssueIdentifier, originalThread }
    }
    const followUp =
      trigger === 'follow_up'
        ? {
            waitingSince: ticket.lastMessageAt,
            daysWaiting: ticket.lastMessageAt
              ? Math.floor((now.getTime() - new Date(ticket.lastMessageAt).getTime()) / 86_400_000)
              : null,
          }
        : null

    const system = buildSystemPrompt(knowledge, { supportMailbox: config.supportMailbox })
    const userMessage = buildUserMessage({
      ticket,
      messages,
      trigger,
      research: research.bundle,
      facts,
      confirmation,
      knowledgeWarnings: knowledge.warnings,
      researchWarnings,
      previousProposal,
      caseOverride,
      release,
      followUp,
      now,
    })

    const attachments = deps.attachments ?? createMemoryAttachmentStore()
    const result = await runToolLoop({
      model: deps.model,
      modelId: config.model,
      maxIterations: config.maxIterations,
      system,
      userMessage,
      tools: allToolDefinitions(),
      toolContext: { tools: deps.tools, now, emailHistory: () => emailHistory(candidateEmails) },
      finalize: (input) =>
        finalizeSubmission(input, {
          ticket,
          messages,
          trigger,
          knowledge,
          facts,
          research: research.bundle,
          researchWarnings,
          confirmation,
          caseOverride,
          attachments,
          now,
        }),
      onToolOutcome: async (source: ProgressSource, ok: boolean) => {
        if (ok) await persistProgress({ [source]: 'ok' })
        else if (progress[source] !== 'ok') await persistProgress({ [source]: 'failed' })
      },
      onTurn: (u) => {
        loopUsage = u
      },
      usage: deps.usage ?? null,
      callMeta: { ticketId, runId, attempt: start.attempt },
      effort: config.effort,
      researchNudgeTurn: config.researchNudgeTurn,
      log,
    })

    for (const t of result.translations)
      await store
        .setMessageTranslation(ticketId, t.messageId, t.translation)
        .catch((e) => log('translation write failed', e))

    const { proposal } = result
    const toStatus = transition('researching', 'needs_decision')
    const written = await store.writeProposal({
      ticketId,
      runId,
      proposal,
      ticket: {
        caseType: proposal.case,
        caseConfidence: proposal.confidence,
        riskLevel: proposal.risk.level,
        riskReason: proposal.risk.reason,
        dueDate: proposal.risk.dueDate,
        stage: proposal.stage,
        instaradarUserId: facts.instaradarUserId,
        stripeCustomerId: facts.stripeCustomerId,
        customerContext,
        tags: facts.tags,
        waitingFor: proposal.customerConfirmationNeeded ? 'Customer confirmation' : null,
      },
      fromStatus: 'researching',
      toStatus,
    })
    const durationMs = Date.now() - startedAt
    await store.finishRun(runId, {
      status: 'succeeded',
      proposalId: written.proposalId,
      durationMs,
      ...runTokens(result.usage),
    })
    log(
      `run ${runId} succeeded in ${durationMs} ms (v${written.version}, ${result.usage.turns} turns, ${usageLine(result.usage)})`,
    )

    if (deps.services) {
      try {
        const verdict = await deps.services.autonomy.evaluate(ticketId)
        if (verdict === 'auto') await deps.services.executor.runAuto(ticketId)
      } catch (e) {
        log('autonomy hand-off failed', e)
      }
    }
    return {
      runId,
      status: 'succeeded',
      proposalId: written.proposalId,
      version: written.version,
      durationMs,
      progress,
      notes: result.notes,
    }
  } catch (e) {
    const durationMs = Date.now() - startedAt
    const error =
      e instanceof AgentLoopError ? e.message : `Agent run failed: ${(e as Error).message}`
    log(`run ${runId} failed: ${error}`)
    await store
      .finishRun(runId, {
        status: 'failed',
        error,
        durationMs,
        ...(loopUsage ? runTokens(loopUsage) : {}),
      })
      .catch(() => {})
    try {
      await store.markRunFailed(
        ticketId,
        'researching',
        transition('researching', 'needs_decision'),
        contextPatch,
      )
    } catch (err) {
      log('could not mark the ticket after the failure', err)
    }
    // Research, model and write failures are worth another attempt (the job runner backs off);
    // the ticket is back in needs_decision meanwhile, and a retried job reuses this run row.
    return { runId, status: 'failed', retryable: true, error, durationMs, progress }
  }
}

function runTokens(u: LoopUsage) {
  return {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens,
    cacheCreationTokens: u.cacheCreationTokens,
    costUsd: u.costUsd,
  }
}

function usageLine(u: LoopUsage): string {
  const tokens = u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens + u.outputTokens
  return `${tokens} tokens${u.costUsd != null ? `, $${u.costUsd.toFixed(4)}` : ''}`
}
