/**
 * In-memory store for unit tests and evals. Same semantics as the Postgres store, including
 * version numbering, superseding the active proposal and the status guard.
 */
import type {
  MessageRow,
  ProposalRow,
  ProposedActionRow,
  TicketRow,
  AgentRunRow,
} from '#shared/api'
import type { AgentTrigger } from '#shared/services'
import { proposalMetaLine } from '#shared/proposal'
import { deterministicUuid } from '#shared/utils/ids'
import type { PreviousTicketSummary, Progress } from '../types'
import type { AgentStore, ReleaseNotificationRef } from './types'

export interface MemorySeed {
  tickets?: TicketRow[]
  messages?: MessageRow[]
  proposals?: ProposalRow[]
  releaseNotifications?: (ReleaseNotificationRef & { notificationTicketId: string })[]
}

let seq = 0
const newId = (prefix: string) => deterministicUuid(`${prefix}:${Date.now()}:${++seq}`)

export function createMemoryAgentStore(seed: MemorySeed = {}) {
  const tickets: TicketRow[] = structuredClone(seed.tickets ?? [])
  const messages: MessageRow[] = structuredClone(seed.messages ?? [])
  const proposals: ProposalRow[] = structuredClone(seed.proposals ?? [])
  const runs: (AgentRunRow & { jobId: string | null; attempt: number })[] = []
  const releaseNotifications = structuredClone(seed.releaseNotifications ?? [])

  const store: AgentStore & {
    tickets: TicketRow[]
    messages: MessageRow[]
    proposals: ProposalRow[]
    runs: typeof runs
    progressHistory: Progress[]
  } = {
    kind: 'memory',
    tickets,
    messages,
    proposals,
    runs,
    progressHistory: [],
    async getTicket(id) {
      return tickets.find((t) => t.id === id) ?? null
    },
    async getMessages(ticketId) {
      return messages
        .filter((m) => m.ticketId === ticketId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },
    async getPreviousTickets(email, exclude): Promise<PreviousTicketSummary[]> {
      return tickets
        .filter((t) => t.customerEmail.toLowerCase() === email.toLowerCase() && t.id !== exclude)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10)
        .map((t) => ({
          id: t.id,
          displayNumber: t.displayNumber,
          subject: t.subject,
          status: t.status,
          caseType: t.caseType,
          resolution: t.resolution,
          createdAt: t.createdAt,
          closedAt: t.closedAt,
          messages: messages
            .filter((m) => m.ticketId === t.id)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            .map((m) => ({
              direction: m.direction,
              at: m.createdAt,
              excerpt: (m.textBody ?? '').slice(0, 300),
            })),
        }))
    },
    async getLatestProposal(ticketId) {
      return (
        proposals.filter((p) => p.ticketId === ticketId).sort((a, b) => b.version - a.version)[0] ??
        null
      )
    },
    async getReleaseNotificationForTicket(ticketId) {
      const r = releaseNotifications.find((x) => x.notificationTicketId === ticketId)
      return r
        ? {
            linearIssueIdentifier: r.linearIssueIdentifier,
            linearIssueId: r.linearIssueId,
            email: r.email,
            originalTicketId: r.originalTicketId,
          }
        : null
    },
    async beginRun(ticketId, trigger: AgentTrigger, model, jobId) {
      if (jobId) {
        const existing = runs.find((r) => r.jobId === jobId)
        if (existing) {
          if (existing.status === 'succeeded')
            return {
              runId: existing.id,
              reused: 'succeeded',
              proposalId: existing.proposalId,
              attempt: existing.attempt,
            }
          if (
            existing.status === 'running' &&
            Date.now() - new Date(existing.startedAt!).getTime() < 10 * 60_000
          )
            return {
              runId: existing.id,
              reused: 'running',
              proposalId: null,
              attempt: existing.attempt,
            }
          existing.status = 'running'
          existing.startedAt = new Date().toISOString()
          existing.finishedAt = null
          existing.error = null
          existing.progress = {}
          existing.attempt += 1
          return { runId: existing.id, reused: null, proposalId: null, attempt: existing.attempt }
        }
      }
      const run = {
        id: newId('run'),
        ticketId,
        trigger,
        status: 'running' as const,
        progress: {},
        startedAt: new Date().toISOString(),
        finishedAt: null,
        durationMs: null,
        model,
        error: null,
        proposalId: null,
        createdAt: new Date().toISOString(),
        jobId,
        attempt: 1,
      }
      runs.push(run)
      return { runId: run.id, reused: null, proposalId: null, attempt: 1 }
    },
    async updateRunProgress(runId, progress) {
      const r = runs.find((x) => x.id === runId)
      if (r) r.progress = { ...progress }
      store.progressHistory.push({ ...progress })
    },
    async finishRun(runId, f) {
      const r = runs.find((x) => x.id === runId)
      if (!r) return
      r.status = f.status
      r.error = f.error ?? null
      r.proposalId = f.proposalId ?? r.proposalId
      r.finishedAt = new Date().toISOString()
      r.durationMs = f.durationMs
    },
    async setTicketStatus(ticketId, from, to) {
      const t = tickets.find((x) => x.id === ticketId)
      if (!t) throw new Error(`Ticket ${ticketId} not found`)
      if (t.status !== from) throw new Error(`Ticket ${ticketId} is ${t.status}, expected ${from}`)
      t.status = to
      t.updatedAt = new Date().toISOString()
    },
    async writeProposal({ ticketId, runId, proposal, ticket: patch, fromStatus, toStatus }) {
      const t = tickets.find((x) => x.id === ticketId)
      if (!t) throw new Error(`Ticket ${ticketId} not found`)
      if (t.status !== fromStatus)
        throw new Error(`Ticket ${ticketId} is ${t.status}, expected ${fromStatus}`)
      const version =
        Math.max(0, ...proposals.filter((p) => p.ticketId === ticketId).map((p) => p.version)) + 1
      for (const p of proposals)
        if (p.ticketId === ticketId && p.status === 'active') p.status = 'superseded'
      const id = newId('proposal')
      const actions: ProposedActionRow[] = proposal.actions.map((a, i) => ({
        id: newId('action'),
        proposalId: id,
        position: i,
        type: a.type,
        params: a.params,
        reason: a.reason,
        stage: a.stage,
        requiredForReply: a.requiredForReply,
        enabled: a.enabled,
      }))
      proposals.push({
        id,
        ticketId,
        runId,
        version,
        caseType: proposal.case,
        confidence: proposal.confidence,
        candidateCases: proposal.candidateCases,
        summaryLine: proposal.summaryLine,
        metaLine: proposal.metaLine ?? proposalMetaLine(proposal),
        riskLevel: proposal.risk.level,
        riskReason: proposal.risk.reason,
        dueDate: proposal.risk.dueDate,
        customerConfirmationNeeded: proposal.customerConfirmationNeeded,
        stage: proposal.stage,
        research: proposal.research,
        researchWarnings: proposal.researchWarnings,
        policyWarnings: proposal.policyWarnings,
        conclusion: proposal.conclusion,
        reply: proposal.reply,
        knowledgeRefs: proposal.knowledgeRefs,
        noKnowledgeFound: proposal.noKnowledgeFound,
        status: 'active',
        createdAt: new Date().toISOString(),
        actions,
      })
      Object.assign(t, {
        caseType: patch.caseType,
        caseConfidence: patch.caseConfidence,
        riskLevel: patch.riskLevel,
        riskReason: patch.riskReason,
        dueDate: patch.dueDate,
        stage: patch.stage,
        instaradarUserId: patch.instaradarUserId,
        stripeCustomerId: patch.stripeCustomerId,
        customerContext: patch.customerContext,
        tags: patch.tags,
        waitingFor: patch.waitingFor,
        status: toStatus,
        updatedAt: new Date().toISOString(),
      })
      const r = runs.find((x) => x.id === runId)
      if (r) r.proposalId = id
      return { proposalId: id, version }
    },
    async markRunFailed(ticketId, from, to, patch) {
      const t = tickets.find((x) => x.id === ticketId)
      if (!t) throw new Error(`Ticket ${ticketId} not found`)
      if (t.status !== from) throw new Error(`Ticket ${ticketId} is ${t.status}, expected ${from}`)
      t.status = to
      if (patch.customerContext) t.customerContext = patch.customerContext
      if (patch.tags) t.tags = patch.tags
      if (patch.instaradarUserId) t.instaradarUserId = patch.instaradarUserId
      if (patch.stripeCustomerId) t.stripeCustomerId = patch.stripeCustomerId
      t.updatedAt = new Date().toISOString()
    },
    async setMessageTranslation(ticketId, messageId, translation) {
      const m = messages.find((x) => x.id === messageId && x.ticketId === ticketId)
      if (m) m.translation = translation
    },
  }
  return store
}

export type MemoryAgentStore = ReturnType<typeof createMemoryAgentStore>
