/**
 * "Approve & send all" (IRDR-481, IRDR-482): approves the active proposal of every eligible unsent
 * draft exactly as proposed, one ticket after the other, through the normal `executor.approve` path.
 *
 * Eligibility is the Auto guard set without the Auto settings (global pause, the case's mode) and
 * without the Auto locks, see `failedGuard` in server/autonomy/evaluate.ts. A stage-1 proposal only
 * sends the reply that asks the customer to confirm. Refunds and immediate cancellations run as
 * proposed (`confirmIrreversible: true`); Delete account is never sent in bulk; Send reply must be
 * enabled. The server decides; the POST recomputes it and only approves a ticket that is still
 * eligible and still on the proposal version the dialog showed, so a regenerated draft is never sent
 * unseen.
 */
import { ACTIONS } from '#shared/actions'
import type {
  ApproveAllPreviewResponse,
  ApproveAllRequest,
  ApproveAllResponse,
  ApproveAllSkipped,
  ApproveAllSkipReason,
  ApproveAllTicket,
} from '#shared/api'
import type { ApproveInput, ApproveResult } from '#shared/services'
import { failedGuard, type EvaluateContext } from '../autonomy/evaluate'

export type BulkVerdict =
  | { send: true; ticket: ApproveAllTicket }
  | { send: false; reason: ApproveAllSkipReason; detail: string }

const skip = (reason: ApproveAllSkipReason, detail: string): BulkVerdict => ({
  send: false,
  reason,
  detail,
})

/** Whether one ticket may be approved as proposed and sent in bulk. Pure. */
export function decideBulk(ctx: EvaluateContext): BulkVerdict {
  const failed = failedGuard(ctx, { settings: false, locks: false })
  const p = ctx.proposal
  if (failed) {
    switch (failed.reason) {
      // paused, always_ask, locked_action and auto are not reachable with these options.
      case 'no_database':
      case 'not_found':
      case 'paused':
      case 'always_ask':
      case 'locked_action':
      case 'auto':
        return skip('not_waiting', failed.detail)
      default:
        return skip(failed.reason, failed.detail)
    }
  }
  const t = ctx.ticket!
  const enabled = p!.actions.filter((a) => a.enabled)
  if (enabled.some((a) => a.type === 'delete_account')) {
    return skip('irreversible_action', 'Delete account is never sent in bulk')
  }
  if (!enabled.some((a) => a.type === 'send_reply')) return skip('no_reply', 'No reply to send')
  if (t.status !== 'needs_decision') return skip('not_waiting', 'Not waiting for a decision')
  if (p!.version == null) return skip('no_proposal', 'No active proposal')
  const refundNow = enabled.find((a) => a.type === 'refund_latest_payment' && a.stage === 'now')
  const amount = refundNow?.params?.amountCents
  return {
    send: true,
    ticket: {
      ticketId: t.id,
      displayNumber: t.displayNumber,
      customerName: t.customerName,
      customerEmail: t.customerEmail,
      caseType: p!.caseType,
      proposalVersion: p!.version,
      refund:
        typeof amount === 'number'
          ? { amountCents: amount, currency: String(refundNow?.params?.currency ?? 'usd') }
          : null,
    },
  }
}

export interface ApproveAllPreviewDeps {
  /** Ticket ids with an unsent reply draft and no agent run queued (`findRegenerableDrafts`). */
  candidates: () => Promise<string[]>
  loadContext: (ticketId: string) => Promise<EvaluateContext>
}

export interface ApproveAllDeps extends ApproveAllPreviewDeps {
  approve: (ticketId: string, input: ApproveInput) => Promise<ApproveResult>
}

/** What the confirmation dialog shows. Reads only. */
export async function previewApproveAll(
  deps: ApproveAllPreviewDeps,
): Promise<ApproveAllPreviewResponse> {
  const eligible: ApproveAllTicket[] = []
  const skipped: ApproveAllSkipped[] = []
  for (const ticketId of await deps.candidates()) {
    const ctx = await deps.loadContext(ticketId)
    const verdict = decideBulk(ctx)
    if (verdict.send) eligible.push(verdict.ticket)
    else {
      skipped.push({
        ticketId,
        displayNumber: ctx.ticket?.displayNumber ?? null,
        reason: verdict.reason,
        detail: verdict.detail,
      })
    }
  }
  return { eligible, skipped }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Approves the requested tickets that are still eligible and still on the requested version, as
 * proposed (`actions: []` keeps every action's proposed state, no reply edit; refunds and immediate
 * cancellations are confirmed). One failure is recorded and the rest go on.
 */
export async function approveAll(
  deps: ApproveAllDeps,
  request: ApproveAllRequest,
): Promise<ApproveAllResponse> {
  const now = await previewApproveAll(deps)
  const eligible = new Map(now.eligible.map((t) => [t.ticketId, t]))
  const notEligible = new Map(now.skipped.map((s) => [s.ticketId, s]))
  const out: ApproveAllResponse = { sent: [], skipped: [], failed: [] }
  const seen = new Set<string>()

  for (const { ticketId, proposalVersion } of request.tickets) {
    if (seen.has(ticketId)) continue
    seen.add(ticketId)
    const ticket = eligible.get(ticketId)
    if (!ticket) {
      out.skipped.push(
        notEligible.get(ticketId) ?? {
          ticketId,
          displayNumber: null,
          reason: 'not_waiting',
          detail: 'No longer waiting for a decision',
        },
      )
      continue
    }
    if (ticket.proposalVersion !== proposalVersion) {
      out.skipped.push({
        ticketId,
        displayNumber: ticket.displayNumber,
        reason: 'stale_version',
        detail: 'The draft changed after the dialog opened',
      })
      continue
    }
    try {
      const result = await deps.approve(ticketId, {
        proposalVersion,
        actions: [],
        confirmIrreversible: true,
      })
      // The approval went through but an action failed or was held (e.g. the reply bounced): the
      // ticket is action_failed and waits for a retry on the ticket, so it is not "sent".
      const broken = result.executions.find((e) => e.status === 'failed' || e.status === 'held')
      if (broken) {
        out.failed.push({
          ticketId,
          displayNumber: ticket.displayNumber,
          error: `${ACTIONS[broken.type].label} ${broken.status}${broken.error ? `: ${broken.error}` : ''}`,
        })
        continue
      }
      out.sent.push({
        ticketId,
        displayNumber: ticket.displayNumber,
        ticketStatus: result.ticketStatus,
      })
    } catch (err) {
      out.failed.push({ ticketId, displayNumber: ticket.displayNumber, error: message(err) })
    }
  }
  return out
}
