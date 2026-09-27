/**
 * The executor service: the decision API behind `services.executor`. Every method locks the ticket
 * row, checks the status machine, records the decision, creates or reuses `action_executions` rows
 * (insert-or-get on the idempotency key) and only then runs anything. Two submits of the same
 * decision can never run a side effect twice: the second one finds the ticket no longer waiting.
 */
import { ACTIONS, safeParseActionParams, sortByActionOrder, type ActionType } from '#shared/actions'
import { CASE_TYPES, type CaseType } from '#shared/case-types'
import { EM_DASH_RE, type ReplyDraft } from '#shared/proposal'
import type {
  ApproveResult,
  ExecutionSummary,
  ExecutorService,
  RejectReason,
} from '#shared/services'
import type { DecisionKind } from '#shared/api'
import type { TicketResolution } from '#shared/status'
import { getPool, withTransaction } from '../utils/db'
import { services } from '../utils/services'
import { describeEffect } from './actions'
import { createClientsFromEnv } from './clients'
import {
  ConfirmRequiredError,
  deriveCustomerConfirmed,
  planApprove,
  waitingForText,
} from './decision'
import { latestAttempts, replyDraftOf, runExecutions, type EngineDeps } from './engine'
import { ExecutorError } from './errors'
import { attemptKey, baseKeyOf, executionIdempotencyKey, manualIdempotencyKey } from './keys'
import * as repo from './repo'
import type { ManualSendBody } from './schemas'
import { createPgStore, type Queryable } from './store'
import type {
  ExecutedBy,
  ExecutionRecord,
  ExecutorDeps,
  ProposalRecord,
  TicketRecord,
} from './types'

export interface MaelleExecutor extends ExecutorService {
  readonly deps: ExecutorDeps
  rejectTicket(
    ticketId: string,
    reason: RejectReason,
    note?: string,
  ): Promise<{ decisionId: string; ticketStatus: string }>
  manualSend(ticketId: string, input: ManualSendBody): Promise<ApproveResult>
  snoozeTicket(
    ticketId: string,
    until: Date,
  ): Promise<{ ticketStatus: string; snoozedUntil: string }>
  unsnoozeTicket(ticketId: string): Promise<{ ticketStatus: string }>
  markDoneTicket(
    ticketId: string,
    note: string,
  ): Promise<{ ticketStatus: string; resolution: TicketResolution }>
  setCaseAndEnqueue(
    ticketId: string,
    caseType: CaseType,
  ): Promise<{ ticketStatus: string; caseType: CaseType; jobId: string }>
}

function summary(e: ExecutionRecord): ExecutionSummary {
  return {
    executionId: e.id,
    type: e.type,
    status: e.status,
    ...(e.result !== null && e.result !== undefined ? { result: e.result } : {}),
    ...(e.error ? { error: e.error } : {}),
  }
}

function byPosition(rows: ExecutionRecord[]): ExecutionRecord[] {
  return [...rows].sort((a, b) => a.position - b.position)
}

/** Rows of one decision: the proposal id, or the manual key prefix. */
export function scopeKeyOf(e: ExecutionRecord): string {
  return e.proposalId ?? e.idempotencyKey.replace(/:p\d+(?::a\d+)?$/, '')
}

function resolutionFor(
  decision: DecisionKind,
  rejectReason: RejectReason | null,
): TicketResolution {
  switch (decision) {
    case 'approved':
      return 'approved'
    case 'approved_with_edits':
      return 'approved_with_edits'
    case 'auto':
      return 'auto'
    case 'rejected':
      return 'rejected'
    case 'marked_done':
      return 'marked_done'
    case 'handled_manually':
      return rejectReason && rejectReason !== 'handle_myself' ? 'rejected' : 'handled_manually'
    case 'snoozed':
      return 'approved'
  }
}

export function createExecutorService(overrides: Partial<ExecutorDeps> = {}): MaelleExecutor {
  const deps: ExecutorDeps = {
    db: overrides.db ?? (() => getPool()),
    clients: overrides.clients ?? createClientsFromEnv().clients,
    store: overrides.store ?? createPgStore(overrides.db ?? (() => getPool())),
    mail: overrides.mail ?? (() => services.mail),
    jobs: overrides.jobs ?? (() => services.jobs),
    now: overrides.now ?? (() => new Date()),
    log:
      overrides.log ??
      ((msg: string) => {
        if (process.env.NODE_ENV !== 'test') console.info(msg)
      }),
  }
  const engine: EngineDeps = {
    db: deps.db,
    clients: deps.clients,
    store: deps.store,
    mail: deps.mail,
    now: deps.now,
    log: deps.log,
  }
  const nowIso = () => deps.now().toISOString()

  async function mustFindTicket(q: Queryable, idOrNumber: string, forUpdate: boolean) {
    const ticket = await repo.findTicket(q, idOrNumber, { forUpdate })
    if (!ticket) throw new ExecutorError(404, 'Ticket not found', { error: 'not_found' })
    return ticket
  }

  function wrongStatus(ticket: TicketRecord, what: string): ExecutorError {
    return new ExecutorError(
      409,
      `${what}: ticket #${ticket.displayNumber} is ${ticket.status.replace(/_/g, ' ')}`,
      { error: 'wrong_status', status: ticket.status },
    )
  }

  /** Cancels queued and held rows that belong to another decision (e.g. stage-1 leftovers). */
  async function cancelOtherPending(
    q: Queryable,
    ticketId: string,
    keepScope: string | null,
    note: string,
  ) {
    const rows = latestAttempts(await repo.listExecutions(q, ticketId))
    for (const e of rows) {
      if (e.status !== 'queued' && e.status !== 'held') continue
      if (keepScope !== null && scopeKeyOf(e) === keepScope) continue
      await repo.updateExecution(q, e.id, {
        status: 'cancelled',
        result: { cancelled: true, note },
        finishedAt: nowIso(),
      })
    }
  }

  async function scopeRows(q: Queryable, ticketId: string, scopeKey: string) {
    return (await repo.listExecutions(q, ticketId)).filter((e) => scopeKeyOf(e) === scopeKey)
  }

  /** Final ticket state after a run: action_failed | auto_pending | waiting_on_customer | closed. */
  async function finalize(
    ticketId: string,
    scopeKey: string,
    resolution: TicketResolution,
    replyDraft: ReplyDraft | null,
  ): Promise<TicketRecord> {
    return withTransaction(async (tx) => {
      const ticket = await mustFindTicket(tx, ticketId, true)
      const latest = latestAttempts(await scopeRows(tx, ticketId, scopeKey))
      const failed = latest.filter((e) => e.status === 'failed' || e.status === 'held')
      const scheduled = latest.some((e) => e.status === 'scheduled')
      const queued = latest.filter((e) => e.status === 'queued' && e.stage === 'after_confirmation')
      if (failed.length > 0) return repo.updateTicketStatus(tx, ticket, 'action_failed')
      if (scheduled) return repo.updateTicketStatus(tx, ticket, 'auto_pending')
      if (queued.length > 0) {
        const draft = replyDraft ?? latest.map(replyDraftOf).find((d) => d) ?? null
        return repo.updateTicketStatus(tx, ticket, 'waiting_on_customer', {
          waitingFor: waitingForText(
            draft,
            queued.map((q) => q.type),
          ),
          stage: 1,
        })
      }
      return repo.updateTicketStatus(tx, ticket, 'closed', { resolution, closedAt: nowIso() })
    })
  }

  interface EnsuredRows {
    toRun: ExecutionRecord[]
    queued: ExecutionRecord[]
    done: ExecutionRecord[]
  }

  /** Insert-or-get the rows of an approval; already succeeded actions are never run again. */
  async function ensureRows(
    tx: Queryable,
    ticket: TicketRecord,
    proposal: ProposalRecord,
    plan: ReturnType<typeof planApprove>,
    by: ExecutedBy,
  ): Promise<EnsuredRows> {
    const existing = latestAttempts(await repo.listExecutions(tx, ticket.id))
    const latestByBase = new Map(existing.map((e) => [baseKeyOf(e.idempotencyKey), e]))
    const out: EnsuredRows = { toRun: [], queued: [], done: [] }
    for (const a of plan.actions) {
      const base = executionIdempotencyKey(ticket.id, proposal.version, a.position)
      const params =
        a.type === 'send_reply' && plan.replyDraft
          ? { ...a.params, draft: plan.replyDraft }
          : a.params
      const latest = latestByBase.get(base)
      const fresh = (attempt: number) =>
        repo.insertExecution(tx, {
          ticketId: ticket.id,
          proposalId: proposal.id,
          proposedActionId: a.proposedActionId,
          type: a.type,
          params,
          executedBy: by,
          status: 'queued',
          idempotencyKey: attemptKey(base, attempt),
          attempt,
          irreversible: a.irreversible,
          result: a.stage === 'after_confirmation' ? { awaitingCustomerConfirmation: true } : null,
        })
      if (a.stage === 'after_confirmation') {
        out.queued.push(latest ?? (await fresh(1)))
        continue
      }
      if (!latest) out.toRun.push(await fresh(1))
      else if (latest.status === 'succeeded') out.done.push(latest)
      else if (latest.status === 'failed' || latest.status === 'cancelled')
        out.toRun.push(await fresh(latest.attempt + 1))
      else
        out.toRun.push(
          await repo.updateExecution(tx, latest.id, {
            status: 'queued',
            params,
            executedBy: by,
            error: null,
            result: null,
            scheduledFor: null,
          }),
        )
    }
    return out
  }

  const executor: MaelleExecutor = {
    deps,

    // ------------------------------------------------------------ approve

    async approve(ticketId, input, by) {
      const prepared = await withTransaction(async (tx) => {
        const ticket = await mustFindTicket(tx, ticketId, true)
        if (ticket.status !== 'needs_decision')
          throw wrongStatus(ticket, 'Not waiting for a decision')
        const proposal = await repo.loadActiveProposal(tx, ticket.id)
        if (!proposal) {
          throw new ExecutorError(409, 'This ticket has no active proposal', {
            error: 'no_proposal',
          })
        }
        const plan = planApprove(proposal, input)
        const settings = await repo.loadSettings(tx, ticket.appId)
        const decision: DecisionKind = by === 'auto' ? 'auto' : plan.decision
        const decisionId = await repo.insertDecision(tx, {
          ticketId: ticket.id,
          proposalId: proposal.id,
          decision,
          note: input.note ?? null,
          replyDiff: plan.replyDiff,
          actionChanges: plan.actionChanges.length > 0 ? plan.actionChanges : null,
          timeToDecideMs: Math.max(
            0,
            deps.now().getTime() - new Date(proposal.createdAt).getTime(),
          ),
        })
        await cancelOtherPending(
          tx,
          ticket.id,
          proposal.id,
          `Superseded by the decision on proposal v${proposal.version}`,
        )
        const rows = await ensureRows(tx, ticket, proposal, plan, by)
        await repo.setProposalStatus(tx, proposal.id, 'decided')
        const executing = await repo.updateTicketStatus(tx, ticket, 'executing')
        return { ticket: executing, proposal, plan, settings, decision, decisionId, rows }
      })
      const { ticket, proposal, plan, settings, decision, decisionId, rows } = prepared
      const scheduleReplyFor =
        by === 'auto' ? new Date(deps.now().getTime() + settings.undoWindowMinutes * 60_000) : null
      const ran = await runExecutions(engine, {
        ticket,
        proposal,
        toRun: rows.toRun,
        scope: await scopeRows(deps.db(), ticket.id, proposal.id),
        executedBy: by,
        replyDraft: plan.replyDraft,
        customerConfirmed: deriveCustomerConfirmed(
          proposal,
          input.note,
          CASE_TYPES[proposal.caseType].requiresConfirmation,
        ),
        scheduleReplyFor,
        settings,
      })
      // Everything disabled: the ticket closes without a reply and says so.
      const resolution: TicketResolution =
        plan.actions.length === 0 ? 'closed_no_reply' : resolutionFor(decision, null)
      const final = await finalize(ticket.id, proposal.id, resolution, plan.replyDraft)
      return {
        decisionId,
        ticketStatus: final.status,
        executions: byPosition([...rows.done, ...ran, ...rows.queued]).map(summary),
      }
    },

    // ------------------------------------------------------------ reject

    async reject(ticketId, reason, note) {
      const r = await executor.rejectTicket(ticketId, reason, note)
      return { decisionId: r.decisionId }
    },

    async rejectTicket(ticketId, reason, note) {
      return withTransaction(async (tx) => {
        const ticket = await mustFindTicket(tx, ticketId, true)
        if (ticket.status !== 'needs_decision') throw wrongStatus(ticket, 'Cannot reject')
        const proposal = await repo.loadActiveProposal(tx, ticket.id)
        if (proposal) await repo.setProposalStatus(tx, proposal.id, 'decided')
        const decisionId = await repo.insertDecision(tx, {
          ticketId: ticket.id,
          proposalId: proposal?.id ?? null,
          decision: 'rejected',
          rejectReason: reason,
          note: note ?? null,
          timeToDecideMs: proposal
            ? Math.max(0, deps.now().getTime() - new Date(proposal.createdAt).getTime())
            : null,
        })
        const manual = await repo.updateTicketStatus(tx, ticket, 'manual')
        return { decisionId, ticketStatus: manual.status }
      })
    },

    // ------------------------------------------------------------ manual send

    async manualSend(ticketId, input) {
      const prepared = await withTransaction(async (tx) => {
        let ticket = await mustFindTicket(tx, ticketId, true)
        if (ticket.status !== 'manual' && ticket.status !== 'needs_decision') {
          throw wrongStatus(ticket, 'Cannot send manually')
        }
        if (EM_DASH_RE.test(input.reply.body) || EM_DASH_RE.test(input.reply.subject)) {
          throw new ExecutorError(400, 'Replies must not contain an em dash', { error: 'em_dash' })
        }
        const actions: { type: ActionType; params: Record<string, unknown> }[] = []
        for (const a of input.actions) {
          if (a.type === 'send_reply') {
            throw new ExecutorError(
              400,
              'The reply is sent separately; do not add Send reply as an action',
              {
                error: 'duplicate_reply',
              },
            )
          }
          const parsed = safeParseActionParams(a.type, a.params)
          if (!parsed.success) {
            throw new ExecutorError(
              400,
              `Invalid params for ${ACTIONS[a.type].label}: ${parsed.error.issues.map((i) => `${i.path.map(String).join('.') || 'params'}: ${i.message}`).join('; ')}`,
              { error: 'invalid_params', type: a.type, issues: parsed.error.issues },
            )
          }
          actions.push({ type: a.type, params: parsed.data as Record<string, unknown> })
        }
        const ordered = sortByActionOrder(actions)
        const irreversible = ordered
          .map((a, i) => ({ ...a, position: i }))
          .filter((a) => ACTIONS[a.type].irreversible)
        if (irreversible.length > 0 && !input.confirmIrreversible) {
          throw new ConfirmRequiredError({
            error: 'confirm_required',
            irreversible: irreversible.map((a) => ({
              position: a.position,
              type: a.type,
              effect: describeEffect(a.type, a.params),
            })),
          })
        }
        const prior = await repo.latestDecision(tx, ticket.id)
        const rejectReason = prior?.decision === 'rejected' ? prior.rejectReason : null
        const resolution: TicketResolution =
          rejectReason === 'handle_myself' || (input.handledManually && !rejectReason)
            ? 'handled_manually'
            : 'rejected'
        const active = await repo.loadActiveProposal(tx, ticket.id)
        if (active) await repo.setProposalStatus(tx, active.id, 'decided')
        const latestProposal = active ?? (await repo.loadLatestProposal(tx, ticket.id))
        if (ticket.status === 'needs_decision')
          ticket = await repo.updateTicketStatus(tx, ticket, 'manual')
        const decisionId = await repo.insertDecision(tx, {
          ticketId: ticket.id,
          proposalId: latestProposal?.id ?? null,
          decision: 'handled_manually',
          rejectReason: rejectReason ?? (input.handledManually ? 'handle_myself' : null),
          note: `Manual reply sent · ${ordered.length} action${ordered.length === 1 ? '' : 's'}`,
        })
        await cancelOtherPending(tx, ticket.id, null, 'Handled manually')
        const draft: ReplyDraft = {
          template: null,
          templateNotionPageId: null,
          to: input.reply.to,
          subject: input.reply.subject,
          body: input.reply.body,
          attachments: [],
        }
        const toRun: ExecutionRecord[] = []
        const all = [
          ...ordered,
          {
            type: 'send_reply' as const,
            params: { to: input.reply.to, cc: [], includeAttachments: false, draft },
          },
        ]
        for (const [i, a] of all.entries()) {
          toRun.push(
            await repo.insertExecution(tx, {
              ticketId: ticket.id,
              proposalId: null,
              proposedActionId: null,
              type: a.type,
              params: a.params,
              executedBy: 'you',
              status: 'queued',
              idempotencyKey: manualIdempotencyKey(ticket.id, decisionId, i),
              attempt: 1,
              irreversible: ACTIONS[a.type].irreversible,
            }),
          )
        }
        const settings = await repo.loadSettings(tx, ticket.appId)
        const executing = await repo.updateTicketStatus(tx, ticket, 'executing')
        return { ticket: executing, decisionId, toRun, settings, resolution, draft, latestProposal }
      })
      const scopeKey = scopeKeyOf(prepared.toRun[0]!)
      const ran = await runExecutions(engine, {
        ticket: prepared.ticket,
        proposal: prepared.latestProposal,
        toRun: prepared.toRun,
        scope: prepared.toRun,
        executedBy: 'you',
        replyDraft: prepared.draft,
        customerConfirmed: true,
        scheduleReplyFor: null,
        settings: prepared.settings,
      })
      const final = await finalize(
        prepared.ticket.id,
        scopeKey,
        prepared.resolution,
        prepared.draft,
      )
      return {
        decisionId: prepared.decisionId,
        ticketStatus: final.status,
        executions: byPosition(ran).map(summary),
      }
    },

    // ------------------------------------------------------------ snooze

    async snooze(ticketId, until) {
      await executor.snoozeTicket(ticketId, until)
    },

    async snoozeTicket(ticketId, until) {
      return withTransaction(async (tx) => {
        const ticket = await mustFindTicket(tx, ticketId, true)
        if (ticket.riskLevel === 'safety') {
          throw new ExecutorError(422, 'Safety tickets cannot be snoozed', { error: 'safety' })
        }
        if (ticket.status !== 'needs_decision') throw wrongStatus(ticket, 'Cannot snooze')
        if (Number.isNaN(until.getTime()) || until.getTime() <= deps.now().getTime()) {
          throw new ExecutorError(400, 'until must be in the future', { error: 'invalid_until' })
        }
        const proposal = await repo.loadActiveProposal(tx, ticket.id)
        await repo.insertDecision(tx, {
          ticketId: ticket.id,
          proposalId: proposal?.id ?? null,
          decision: 'snoozed',
          note: `Returns ${until.toISOString()}`,
          timeToDecideMs: proposal
            ? Math.max(0, deps.now().getTime() - new Date(proposal.createdAt).getTime())
            : null,
        })
        const snoozed = await repo.updateTicketStatus(tx, ticket, 'snoozed', {
          snoozedUntil: until.toISOString(),
        })
        return { ticketStatus: snoozed.status, snoozedUntil: until.toISOString() }
      })
    },

    async unsnooze(ticketId) {
      await executor.unsnoozeTicket(ticketId)
    },

    async unsnoozeTicket(ticketId) {
      return withTransaction(async (tx) => {
        const ticket = await mustFindTicket(tx, ticketId, true)
        if (ticket.status !== 'snoozed') throw wrongStatus(ticket, 'Not snoozed')
        const back = await repo.updateTicketStatus(tx, ticket, 'needs_decision', {
          snoozedUntil: null,
        })
        return { ticketStatus: back.status }
      })
    },

    // ------------------------------------------------------------ retry

    async retry(ticketId) {
      const prepared = await withTransaction(async (tx) => {
        const ticket = await mustFindTicket(tx, ticketId, true)
        if (ticket.status !== 'action_failed') throw wrongStatus(ticket, 'Nothing to retry')
        const latest = latestAttempts(await repo.listExecutions(tx, ticket.id))
        const failedOrHeld = latest.filter((e) => e.status === 'failed' || e.status === 'held')
        const first = failedOrHeld[0]
        if (!first) {
          throw new ExecutorError(409, 'Nothing to retry: no failed or held action', {
            error: 'nothing_to_retry',
          })
        }
        const scopeKey = scopeKeyOf(first)
        const toRun: ExecutionRecord[] = []
        for (const e of failedOrHeld.filter((x) => scopeKeyOf(x) === scopeKey)) {
          if (e.status === 'held') {
            toRun.push(await repo.updateExecution(tx, e.id, { status: 'queued', error: null }))
          } else {
            toRun.push(
              await repo.insertExecution(tx, {
                ticketId: e.ticketId,
                proposalId: e.proposalId,
                proposedActionId: e.proposedActionId,
                type: e.type,
                params: e.params,
                executedBy: 'you',
                status: 'queued',
                idempotencyKey: attemptKey(baseKeyOf(e.idempotencyKey), e.attempt + 1),
                attempt: e.attempt + 1,
                irreversible: e.irreversible,
              }),
            )
          }
        }
        const proposal = first.proposalId ? await repo.loadProposalById(tx, first.proposalId) : null
        const decision = await repo.latestDecision(tx, ticket.id)
        const settings = await repo.loadSettings(tx, ticket.appId)
        const executing = await repo.updateTicketStatus(tx, ticket, 'executing')
        return { ticket: executing, proposal, decision, settings, scopeKey, toRun }
      })
      const { ticket, proposal, decision, settings, scopeKey, toRun } = prepared
      const scope = await scopeRows(deps.db(), ticket.id, scopeKey)
      const draft = scope.map(replyDraftOf).find((d) => d) ?? proposal?.replyDraft ?? null
      const ran = await runExecutions(engine, {
        ticket,
        proposal,
        toRun,
        scope,
        executedBy: 'you',
        replyDraft: draft,
        // A manual send carries the human's confirmation; a proposal derives it.
        customerConfirmed: proposal
          ? deriveCustomerConfirmed(
              proposal,
              decision?.note ?? undefined,
              CASE_TYPES[proposal.caseType].requiresConfirmation,
            )
          : true,
        scheduleReplyFor: null,
        settings,
      })
      const resolution = decision
        ? resolutionFor(decision.decision, decision.rejectReason)
        : 'approved'
      const final = await finalize(ticket.id, scopeKey, resolution, draft)
      return {
        // A retry belongs to the decision that created the failed rows.
        decisionId: decision?.id ?? '',
        ticketStatus: final.status,
        executions: byPosition(ran).map(summary),
      }
    },

    // ------------------------------------------------------------ mark done

    async markDone(ticketId, note) {
      await executor.markDoneTicket(ticketId, note)
    },

    async markDoneTicket(ticketId, note) {
      if (!note?.trim())
        throw new ExecutorError(400, 'A note is required', { error: 'note_required' })
      return withTransaction(async (tx) => {
        const ticket = await mustFindTicket(tx, ticketId, true)
        if (ticket.status !== 'action_failed' && ticket.status !== 'manual') {
          throw wrongStatus(
            ticket,
            'Mark done is for tickets with a failed action or handled manually',
          )
        }
        await cancelOtherPending(tx, ticket.id, null, `Marked done: ${note.trim()}`)
        const active = await repo.loadActiveProposal(tx, ticket.id)
        if (active) await repo.setProposalStatus(tx, active.id, 'decided')
        const latest = active ?? (await repo.loadLatestProposal(tx, ticket.id))
        await repo.insertDecision(tx, {
          ticketId: ticket.id,
          proposalId: latest?.id ?? null,
          decision: 'marked_done',
          note: note.trim(),
        })
        const closed = await repo.updateTicketStatus(tx, ticket, 'closed', {
          resolution: 'marked_done',
          closedAt: nowIso(),
        })
        return { ticketStatus: closed.status, resolution: 'marked_done' as const }
      })
    },

    // ------------------------------------------------------------ case override

    async setCase(ticketId, caseType) {
      await executor.setCaseAndEnqueue(ticketId, caseType)
    },

    async setCaseAndEnqueue(ticketId, caseType) {
      if (caseType === 'unclear') {
        throw new ExecutorError(400, 'Pick one of the candidate cases, not "unclear"', {
          error: 'invalid_case',
        })
      }
      const ticket = await withTransaction(async (tx) => {
        const t = await mustFindTicket(tx, ticketId, true)
        if (t.status !== 'needs_decision') throw wrongStatus(t, 'Cannot change the case')
        return repo.updateTicketStatus(tx, t, 'researching', { caseType, caseConfidence: 1 })
      })
      const job = await deps
        .jobs()
        .enqueue('agent_run', { ticketId: ticket.id, trigger: 'case_override' })
      return { ticketStatus: ticket.status, caseType, jobId: job.id }
    },

    // ------------------------------------------------------------ undo (Auto)

    async undo(ticketId) {
      return withTransaction(async (tx) => {
        const ticket = await mustFindTicket(tx, ticketId, true)
        if (ticket.status !== 'auto_pending') throw wrongStatus(ticket, 'Nothing to undo')
        const latest = latestAttempts(await repo.listExecutions(tx, ticket.id))
        const scheduled = latest.filter((e) => e.status === 'scheduled')
        if (scheduled.length === 0) {
          const running = latest.some((e) => e.status === 'running')
          throw new ExecutorError(
            409,
            running
              ? 'Too late: the reply is already being sent'
              : 'Nothing to undo: no scheduled reply',
            { error: 'nothing_to_undo' },
          )
        }
        const scopeKey = scopeKeyOf(scheduled[0]!)
        const alreadyRan = latest.filter(
          (e) => e.status === 'succeeded' && scopeKeyOf(e) === scopeKey,
        )
        const ranLabels = alreadyRan.map((e) => ACTIONS[e.type].label)
        const cancelled: ExecutionRecord[] = []
        for (const e of scheduled) {
          cancelled.push(
            await repo.updateExecution(tx, e.id, {
              status: 'cancelled',
              result: {
                cancelled: true,
                undone: true,
                undoneAt: nowIso(),
                alreadyRan: ranLabels,
                note:
                  ranLabels.length > 0
                    ? `Undone · already ran: ${ranLabels.join(', ')}`
                    : 'Undone before anything ran',
              },
              finishedAt: nowIso(),
            }),
          )
        }
        if (scheduled[0]!.proposalId)
          await repo.setProposalStatus(tx, scheduled[0]!.proposalId, 'active')
        await repo.updateTicketStatus(tx, ticket, 'needs_decision')
        return {
          cancelled: cancelled.map(summary),
          alreadyRan: byPosition(alreadyRan).map(summary),
        }
      })
    },

    // ------------------------------------------------------------ Auto

    async runAuto(ticketId) {
      const refused = (reason: string) => ({ ran: false, refused: reason })
      const db = deps.db()
      const ticket = await repo.findTicket(db, ticketId)
      if (!ticket) return refused('Ticket not found')
      if (ticket.status !== 'needs_decision')
        return refused(`Ticket is ${ticket.status.replace(/_/g, ' ')}`)
      const settings = await repo.loadSettings(db, ticket.appId)
      if (settings.globalPause) return refused('Global pause is on')
      if (ticket.riskLevel !== 'none') return refused(`Risk level is ${ticket.riskLevel}`)
      const proposal = await repo.loadActiveProposal(db, ticket.id)
      if (!proposal) return refused('No active proposal')
      if (proposal.caseType === 'unclear') return refused('Case is unclear')
      if (proposal.riskLevel !== 'none')
        return refused(`Proposal risk level is ${proposal.riskLevel}`)
      if (proposal.policyWarnings.length > 0) {
        return refused(`Policy warnings: ${proposal.policyWarnings.join('; ')}`)
      }
      const enabled = proposal.actions.filter((a) => a.enabled)
      if (
        proposal.customerConfirmationNeeded &&
        proposal.stage === 1 &&
        enabled.some((a) => a.stage === 'after_confirmation')
      ) {
        return refused('Customer confirmation pending')
      }
      if (!proposal.replyDraft || !enabled.some((a) => a.type === 'send_reply')) {
        return refused('No reply to send')
      }
      const locks = await repo.loadLocks(db, ticket.appId)
      const locked = enabled.filter((a) => locks.get(a.type) ?? ACTIONS[a.type].lockedByDefault)
      if (locked.length > 0) {
        return refused(`Locked for Auto: ${locked.map((a) => ACTIONS[a.type].label).join(', ')}`)
      }
      try {
        const result = await executor.approve(
          ticket.id,
          {
            proposalVersion: proposal.version,
            actions: proposal.actions.map((a) => ({ position: a.position, enabled: a.enabled })),
            // Irreversible actions only get here when Phillip unlocked them for Auto.
            confirmIrreversible: true,
          },
          'auto',
        )
        return { ran: true, executions: result.executions }
      } catch (err) {
        if (err instanceof ExecutorError) return refused(err.message)
        throw err
      }
    },

    async runDueScheduled() {
      const due = await withTransaction(async (tx) => {
        const rows = await repo.claimDueScheduled(tx, deps.now())
        const claimed: ExecutionRecord[] = []
        for (const r of rows) {
          claimed.push(
            await repo.updateExecution(tx, r.id, { status: 'running', startedAt: nowIso() }),
          )
        }
        return claimed
      })
      let ran = 0
      for (const row of due) {
        const db = deps.db()
        const ticket = await repo.findTicket(db, row.ticketId)
        if (!ticket) continue
        const proposal = row.proposalId ? await repo.loadProposalById(db, row.proposalId) : null
        const settings = await repo.loadSettings(db, ticket.appId)
        const scopeKey = scopeKeyOf(row)
        const [done] = await runExecutions(engine, {
          ticket,
          proposal,
          toRun: [{ ...row, status: 'queued' }],
          scope: await scopeRows(db, ticket.id, scopeKey),
          executedBy: 'auto',
          replyDraft: replyDraftOf(row),
          customerConfirmed: false,
          scheduleReplyFor: null,
          settings,
        })
        ran += 1
        await withTransaction(async (tx) => {
          const t = await mustFindTicket(tx, ticket.id, true)
          if (t.status !== 'auto_pending') return
          if (done?.status === 'succeeded') {
            await repo.updateTicketStatus(tx, t, 'closed', {
              resolution: 'auto',
              closedAt: nowIso(),
            })
          } else {
            // The send failed: back to the inbox with the proposal active, so a human decides.
            await repo.updateTicketStatus(tx, t, 'needs_decision')
            if (proposal) await repo.setProposalStatus(tx, proposal.id, 'active')
          }
        })
      }
      return { ran }
    },
  }
  return executor
}
