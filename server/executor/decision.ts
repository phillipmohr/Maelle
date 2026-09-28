/**
 * Pure planning for an approval: validates the request against the active proposal (version,
 * registry, params, em dash, confirmIrreversible), merges edits and added actions, and computes the
 * decision kind, the reply diff and the action changes. No database, no side effects.
 */
import {
  ACTIONS,
  isActionType,
  safeParseActionParams,
  sortByActionOrder,
  type ActionStage,
  type ActionType,
} from '#shared/actions'
import { EM_DASH_RE, type ReplyDraft } from '#shared/proposal'
import type { ApproveInput } from '#shared/services'
import type { ConfirmRequiredResponse } from '#shared/api'
import { describeEffect } from './actions'
import { paramChanges, replyDiff, type ActionChange, type ReplyDiff } from './diff'
import { ExecutorError } from './errors'
import type { ProposalRecord } from './types'

export interface PlannedAction {
  position: number
  type: ActionType
  /** Validated params (schema output). */
  params: Record<string, unknown>
  stage: ActionStage
  requiredForReply: boolean
  proposedActionId: string | null
  irreversible: boolean
  reason: string
  added: boolean
}

export interface ApprovePlan {
  decision: 'approved' | 'approved_with_edits'
  /** The reply Send reply sends; null when no Send reply action is enabled. */
  replyDraft: ReplyDraft | null
  replyDiff: ReplyDiff | null
  actionChanges: ActionChange[]
  /** Enabled actions in registry order, Send reply last. */
  actions: PlannedAction[]
  irreversibleNow: PlannedAction[]
}

export class ConfirmRequiredError extends ExecutorError {
  readonly body: ConfirmRequiredResponse
  constructor(body: ConfirmRequiredResponse) {
    super(
      409,
      'Confirm the irreversible actions first (press A again)',
      body as unknown as Record<string, unknown>,
    )
    this.name = 'ConfirmRequiredError'
    this.body = body
  }
}

function formatIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `${i.path.map(String).join('.') || 'params'}: ${i.message}`).join('; ')
}

export function planApprove(proposal: ProposalRecord, input: ApproveInput): ApprovePlan {
  if (input.proposalVersion !== proposal.version) {
    throw new ExecutorError(409, 'Stale proposal version', {
      error: 'stale_version',
      current: proposal.version,
    })
  }
  if (proposal.caseType === 'unclear') {
    throw new ExecutorError(422, 'Pick a case type first: this proposal is unclear', {
      error: 'unclear_case',
    })
  }
  const byPosition = new Map(proposal.actions.map((a) => [a.position, a]))
  for (const edit of input.actions ?? []) {
    if (!byPosition.has(edit.position)) {
      throw new ExecutorError(400, `No proposed action at position ${edit.position}`, {
        error: 'unknown_position',
        position: edit.position,
      })
    }
  }
  const edits = new Map((input.actions ?? []).map((a) => [a.position, a]))
  const actionChanges: ActionChange[] = []
  const planned: PlannedAction[] = []

  for (const a of proposal.actions) {
    const edit = edits.get(a.position)
    const enabled = edit ? edit.enabled : a.enabled
    if (enabled !== a.enabled) {
      actionChanges.push({ position: a.position, field: 'enabled', from: a.enabled, to: enabled })
    }
    const rawParams = edit?.params ?? a.params
    if (edit?.params) actionChanges.push(...paramChanges(a.position, a.params, edit.params))
    if (!enabled) continue
    const parsed = safeParseActionParams(a.type, rawParams)
    if (!parsed.success) {
      throw new ExecutorError(
        400,
        `Invalid params for ${ACTIONS[a.type].label}: ${formatIssues(parsed.error.issues)}`,
        { error: 'invalid_params', position: a.position, issues: parsed.error.issues },
      )
    }
    planned.push({
      position: a.position,
      type: a.type,
      params: parsed.data as Record<string, unknown>,
      stage: a.stage,
      requiredForReply: a.requiredForReply,
      proposedActionId: a.id,
      irreversible: ACTIONS[a.type].irreversible,
      reason: a.reason,
      added: false,
    })
  }

  let nextPosition = proposal.actions.reduce((m, a) => Math.max(m, a.position), -1) + 1
  for (const added of input.addedActions ?? []) {
    if (!isActionType(added.type)) {
      throw new ExecutorError(400, `Unknown action ${String(added.type)}`, {
        error: 'unknown_action',
        type: added.type,
      })
    }
    const parsed = safeParseActionParams(added.type, added.params)
    if (!parsed.success) {
      throw new ExecutorError(
        400,
        `Invalid params for ${ACTIONS[added.type].label}: ${formatIssues(parsed.error.issues)}`,
        { error: 'invalid_params', type: added.type, issues: parsed.error.issues },
      )
    }
    const position = nextPosition++
    actionChanges.push({ position, field: 'added', from: null, to: added.type })
    planned.push({
      position,
      type: added.type,
      params: parsed.data as Record<string, unknown>,
      stage: 'now',
      requiredForReply: false,
      proposedActionId: null,
      irreversible: ACTIONS[added.type].irreversible,
      reason: added.reason,
      added: true,
    })
  }

  const replies = planned.filter((p) => p.type === 'send_reply')
  if (replies.length > 1) {
    throw new ExecutorError(400, 'Only one Send reply action is allowed', {
      error: 'duplicate_reply',
    })
  }
  let replyDraft: ReplyDraft | null = null
  let diff: ReplyDiff | null = null
  if (replies.length === 1) {
    if (!proposal.replyDraft) {
      throw new ExecutorError(422, 'Send reply needs a reply draft', { error: 'no_reply_draft' })
    }
    replyDraft = {
      ...proposal.replyDraft,
      subject: input.reply?.subject ?? proposal.replyDraft.subject,
      body: input.reply?.body ?? proposal.replyDraft.body,
      attachments: input.reply?.attachments ?? proposal.replyDraft.attachments ?? [],
    }
    if (EM_DASH_RE.test(replyDraft.body) || EM_DASH_RE.test(replyDraft.subject)) {
      throw new ExecutorError(400, 'Replies must not contain an em dash', { error: 'em_dash' })
    }
    if (!replyDraft.body.trim() || !replyDraft.subject.trim()) {
      throw new ExecutorError(400, 'The reply needs a subject and a body', { error: 'empty_reply' })
    }
    diff = replyDiff(proposal.replyDraft, replyDraft)
  }

  const actions = sortByActionOrder(planned)
  const irreversibleNow = actions.filter((a) => a.irreversible && a.stage === 'now')
  if (irreversibleNow.length > 0 && !input.confirmIrreversible) {
    throw new ConfirmRequiredError({
      error: 'confirm_required',
      irreversible: irreversibleNow.map((a) => ({
        position: a.position,
        type: a.type,
        effect: describeEffect(a.type, a.params),
      })),
    })
  }

  const edited = diff !== null || actionChanges.length > 0
  return {
    decision: edited ? 'approved_with_edits' : 'approved',
    replyDraft,
    replyDiff: diff,
    actionChanges,
    actions,
    irreversibleNow,
  }
}

/**
 * The customer confirmed when the proposal is stage 2, when a confirmation-requiring case no longer
 * needs one (the agent found it in the thread), or when the approver's note says so.
 */
export function deriveCustomerConfirmed(
  proposal: ProposalRecord | null,
  note: string | undefined,
  requiresConfirmation: boolean,
): boolean {
  if (proposal?.stage === 2) return true
  if (proposal && requiresConfirmation && !proposal.customerConfirmationNeeded) return true
  if (note && noteConfirms(note)) return true
  return false
}

const NOTE_CONFIRMS_RE = /\bconfirm(ed|s|ation)?\b/i
/** "not confirmed", "no confirmation", "awaiting confirmation", "unconfirmed" are not a yes. */
const NOTE_DENIES_RE =
  /\b(not|no|never|hasn'?t|haven'?t|didn'?t|isn'?t|without|awaiting|pending|needs?|waiting (for|on)|yet to|still to|un)[\s-]*(yet\s+|explicitly\s+|to\s+)?confirm/i

/** True only for an affirmative confirmation in the approver's note. */
export function noteConfirms(note: string): boolean {
  return NOTE_CONFIRMS_RE.test(note) && !NOTE_DENIES_RE.test(note)
}

/** "Waiting for “Yes, refund”" from the quoted phrase in the reply, else from the queued actions. */
export function waitingForText(replyDraft: ReplyDraft | null, queuedTypes: ActionType[]): string {
  const m = replyDraft ? /[“"]((?:Yes|Ja|Sì|Oui)[^”"]{0,40})[”"]/i.exec(replyDraft.body) : null
  if (m?.[1]) return `Waiting for “${m[1]}”`
  if (queuedTypes.includes('delete_account')) return 'Waiting for “Yes, delete”'
  if (queuedTypes.includes('refund_latest_payment')) return 'Waiting for “Yes, refund”'
  return "Waiting for the customer's confirmation"
}
