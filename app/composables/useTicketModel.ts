/**
 * View model for the ticket detail: labels, notes, chips, action states and toast lines derived from
 * the TicketDetailResponse. Pure functions (no Nuxt APIs), unit tested, used by the ticket
 * components and by the decision state machine.
 */
import type {
  ActionExecutionRow,
  ExecutionStatus,
  ProposalRow,
  ProposedActionRow,
  TicketDetailResponse,
  TicketRow,
} from '#shared/api'
import type { ExecutionSummary } from '#shared/services'
import { ACTIONS, isIrreversible, type ActionType } from '#shared/actions'
import { caseShortLabel, notionPageUrl } from '#shared/case-types'
import type { ResearchItem, SourceChip } from '#shared/proposal'
import { RESOLUTION_LABELS } from '#shared/status'
import type { PillStatus } from '~/components/ui/StatusPill.vue'
import { ageShort, money, plural, shortDate } from '~/utils/format'

/** An action as the checklist edits it: the proposed row plus the user's changes. */
export interface EditableAction {
  key: string
  position: number
  type: ActionType
  params: Record<string, unknown>
  reason: string
  stage: 'now' | 'after_confirmation'
  requiredForReply: boolean
  enabled: boolean
  /** Added from the registry by the user (not in the proposal). */
  added: boolean
  /** Params differ from the proposal. */
  edited: boolean
}

export function toEditable(a: ProposedActionRow): EditableAction {
  return {
    key: a.id,
    position: a.position,
    type: a.type,
    params: { ...a.params },
    reason: a.reason,
    stage: a.stage,
    requiredForReply: a.requiredForReply,
    enabled: a.enabled,
    added: false,
    edited: false,
  }
}

export function firstName(ticket: Pick<TicketRow, 'customerName' | 'customerEmail'>): string {
  const n = ticket.customerName?.trim()
  if (n) return n.split(/\s+/)[0]!
  return ticket.customerEmail.split('@')[0]!
}

// ---------------------------------------------------------------- proposal and decision bar

export function irreversibleNow(actions: readonly EditableAction[]): EditableAction[] {
  return actions.filter((a) => a.enabled && a.stage === 'now' && isIrreversible(a.type))
}

export function queuedActions(actions: readonly EditableAction[]): EditableAction[] {
  return actions.filter((a) => a.enabled && a.stage === 'after_confirmation')
}

export function isRoutine(actions: readonly EditableAction[], ticket: TicketRow): boolean {
  return (
    ticket.riskLevel === 'none' &&
    irreversibleNow(actions).length === 0 &&
    queuedActions(actions).length === 0 &&
    ticket.caseType !== 'unclear'
  )
}

/** "Approve & execute" · "Approve & send" · "Approve stage 1" */
export function primaryLabel(
  actions: readonly EditableAction[],
  proposal: ProposalRow | null,
): string {
  const enabled = actions.filter((a) => a.enabled)
  if (
    proposal?.customerConfirmationNeeded &&
    proposal.stage === 1 &&
    queuedActions(actions).length > 0
  )
    return 'Approve stage 1'
  if (enabled.length > 0 && enabled.every((a) => a.type === 'send_reply')) return 'Approve & send'
  return 'Approve & execute'
}

const WAIT_WORD: Partial<Record<ActionType, string>> = {
  refund_latest_payment: 'refund',
  cancel_immediately: 'cancellation',
  delete_account: 'deletion',
  remove_from_tracking: 'removal',
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** The small note next to the buttons in normal mode. */
export function barNote(
  actions: readonly EditableAction[],
  proposal: ProposalRow | null,
  ticket: TicketRow,
): string {
  const enabled = actions.filter((a) => a.enabled)
  const queued = queuedActions(actions)
  if (proposal?.customerConfirmationNeeded && proposal.stage === 1 && queued.length > 0) {
    const words = [
      ...new Set(queued.map((a) => WAIT_WORD[a.type] ?? ACTIONS[a.type].label.toLowerCase())),
    ]
    return `Sends the reply now · ${joinWords(words)} wait for ${firstName(ticket)}`
  }
  const irr = irreversibleNow(actions)
  if (enabled.length === 1 && enabled[0]!.type === 'send_reply') return '1 action · reply only'
  if (irr.length === 0)
    return `${plural(enabled.length, 'action')} · all reversible · no confirmation needed`
  return `${plural(enabled.length, 'action')} · ${irr.length} irreversible · A twice to run`
}

/** "Refund $13.07 to Visa ··2291", "Cancel immediately and delete 2 profiles", … */
export function effectLine(a: Pick<EditableAction, 'type' | 'params'>): string {
  const p = a.params
  switch (a.type) {
    case 'refund_latest_payment': {
      const amount =
        typeof p.amountCents === 'number'
          ? money(p.amountCents, String(p.currency ?? 'usd'))
          : 'the payment'
      return `Refund ${amount}${p.cardLabel ? ` to ${String(p.cardLabel)}` : ''}`
    }
    case 'cancel_immediately': {
      const n = typeof p.profilesAffected === 'number' ? p.profilesAffected : null
      return n == null
        ? 'Cancel immediately'
        : `Cancel immediately and delete ${plural(n, 'profile')}`
    }
    case 'delete_account':
      return `Delete the account${p.email ? ` ${String(p.email)}` : ''}`
    case 'remove_from_tracking':
      return `Remove @${String(p.instagramHandle ?? '').replace(/^@/, '')} from tracking`
    default:
      return ACTIONS[a.type].label
  }
}

/** The note in confirm mode: every irreversible effect, joined with " · ". */
export function confirmNote(actions: readonly EditableAction[]): string {
  return irreversibleNow(actions).map(effectLine).join(' · ')
}

/** Mono parameter summary next to the action name. */
export function paramsSummary(a: Pick<EditableAction, 'type' | 'params'>, attachments = 0): string {
  const p = a.params
  const s = (v: unknown) => (v == null ? '' : String(v))
  switch (a.type) {
    case 'cancel_at_period_end':
      return p.accessUntil
        ? `access until ${shortDate(`${s(p.accessUntil)}T12:00:00`)}`
        : 'at period end'
    case 'cancel_immediately':
      return typeof p.profilesAffected === 'number'
        ? `deletes ${plural(p.profilesAffected, 'profile')}`
        : 'now'
    case 'refund_latest_payment': {
      const parts: string[] = []
      if (typeof p.amountCents === 'number')
        parts.push(money(p.amountCents, s(p.currency) || 'usd'))
      if (p.paymentDate) parts.push(shortDate(`${s(p.paymentDate)}T12:00:00`))
      if (p.cardLabel) parts.push(s(p.cardLabel))
      return parts.join(' · ')
    }
    case 'delete_account':
      return s(p.email)
    case 'stop_failed_payment_retries':
      return Array.isArray(p.stripeInvoiceIds) && p.stripeInvoiceIds.length
        ? plural(p.stripeInvoiceIds.length, 'open invoice')
        : 'open invoices'
    case 'create_coupon': {
      const off =
        p.kind === 'amount' && typeof p.amountOffCents === 'number'
          ? `${money(p.amountOffCents, s(p.currency) || 'usd')} off`
          : typeof p.percentOff === 'number'
            ? `${p.percentOff}% off`
            : 'coupon'
      return `${off}${p.duration ? ` · ${s(p.duration)}` : ''}`
    }
    case 'create_linear_ticket':
      return p.existingIssueIdentifier
        ? `linked existing ${s(p.existingIssueIdentifier)}`
        : [s(p.label), p.title ? `“${s(p.title)}”` : ''].filter(Boolean).join(' · ')
    case 'store_release_notification_email':
      return s(p.linearIssueIdentifier) || 'from the Linear ticket above'
    case 'store_cancellation_reason':
      return p.comment ? `“${s(p.comment)}”` : s(p.feedback)
    case 'remove_from_tracking':
      return `@${s(p.instagramHandle).replace(/^@/, '')}`
    case 'send_reply':
      return [`to ${s(p.to)}`, attachments > 0 ? plural(attachments, 'attachment') : '']
        .filter(Boolean)
        .join(' · ')
    default:
      return ''
  }
}

// ---------------------------------------------------------------- action state from the audit log

export interface ActionState {
  tone: 'default' | 'success' | 'error' | 'queued' | 'held'
  pill: { status: PillStatus; label: string } | null
  error: string | null
  execution: ActionExecutionRow | null
}

/** Latest execution for an action (by proposed action id, then by type). */
export function latestExecution(
  a: Pick<EditableAction, 'type' | 'key'>,
  executions: readonly ActionExecutionRow[],
  proposalId: string | null,
): ActionExecutionRow | null {
  const mine = executions.filter(
    (e) =>
      e.type === a.type &&
      (proposalId == null || e.proposalId == null || e.proposalId === proposalId),
  )
  if (mine.length === 0) return null
  return [...mine].sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.attempt - y.attempt)[
    mine.length - 1
  ]!
}

export function actionState(
  a: EditableAction,
  executions: readonly ActionExecutionRow[],
  proposalId: string | null,
  live?: ExecutionSummary | null,
): ActionState {
  const ex = latestExecution(a, executions, proposalId)
  const status: ExecutionStatus | null = live?.status ?? ex?.status ?? null
  if (status === 'succeeded') {
    const linked =
      (ex?.result as { linked?: boolean } | null)?.linked ||
      (live?.result as { linked?: boolean } | null)?.linked
    return {
      tone: 'success',
      pill: {
        status: 'success',
        label: linked ? 'Linked' : a.type === 'send_reply' ? 'Sent' : 'Done',
      },
      error: null,
      execution: ex,
    }
  }
  if (status === 'failed')
    return {
      tone: 'error',
      pill: { status: 'error', label: 'Failed' },
      error: live?.error ?? ex?.error ?? null,
      execution: ex,
    }
  if (status === 'held')
    return {
      tone: 'held',
      pill: { status: 'warning', label: 'Held back' },
      error: null,
      execution: ex,
    }
  if (status === 'running')
    return {
      tone: 'queued',
      pill: { status: 'info', label: 'Running' },
      error: null,
      execution: ex,
    }
  if (status === 'queued' || status === 'scheduled' || a.stage === 'after_confirmation')
    return {
      tone: 'queued',
      pill: {
        status: 'info',
        label: status === 'scheduled' ? 'Scheduled' : 'Queued · pending confirmation',
      },
      error: null,
      execution: ex,
    }
  if (status === 'cancelled')
    return {
      tone: 'default',
      pill: { status: 'neutral', label: 'Cancelled' },
      error: null,
      execution: ex,
    }
  if (a.requiredForReply)
    return {
      tone: 'default',
      pill: { status: 'draft', label: 'Required' },
      error: null,
      execution: ex,
    }
  return { tone: 'default', pill: null, error: null, execution: ex }
}

// ---------------------------------------------------------------- header

export function headerPills(
  ticket: TicketRow,
  proposal: ProposalRow | null,
  executions: readonly ActionExecutionRow[],
): { status: PillStatus; label: string; dot?: boolean }[] {
  const pills: { status: PillStatus; label: string; dot?: boolean }[] = []
  if (ticket.riskLevel === 'high') pills.push({ status: 'warning', label: 'High risk' })
  if (ticket.riskLevel === 'safety') pills.push({ status: 'error', label: 'Safety · pinned' })
  switch (ticket.status) {
    case 'new':
    case 'researching':
      pills.push({ status: 'info', label: 'Researching' })
      break
    case 'needs_decision':
      if (proposal?.customerConfirmationNeeded && proposal.stage === 1)
        pills.push({ status: 'info', label: 'Needs customer confirmation' })
      if (ticket.stage === 2) pills.push({ status: 'success', label: 'Customer confirmed' })
      pills.push({
        status: 'draft',
        label: ticket.caseType === 'unclear' ? 'Pick the case' : 'Needs decision',
      })
      break
    case 'executing':
      pills.push({ status: 'info', label: 'Executing' })
      break
    case 'action_failed': {
      const failed = executions.filter((e) => e.status === 'failed').length || 1
      pills.push({ status: 'error', label: `${plural(failed, 'action')} failed` })
      break
    }
    case 'waiting_on_customer':
      pills.push({ status: 'info', label: 'Waiting on customer' })
      break
    case 'snoozed':
      pills.push({ status: 'neutral', label: 'Snoozed' })
      break
    case 'manual':
      pills.push({ status: 'neutral', label: 'Handling manually' })
      break
    case 'auto_pending':
      pills.push({ status: 'draft', label: 'Auto · undo window', dot: false })
      break
    case 'closed':
      pills.push(
        ticket.resolution === 'rejected'
          ? { status: 'error', label: 'Rejected' }
          : ticket.resolution === 'approved_with_edits'
            ? { status: 'info', label: 'Approved with edits' }
            : ticket.resolution === 'auto'
              ? { status: 'draft', label: 'Auto', dot: false }
              : ticket.resolution === 'approved'
                ? { status: 'success', label: 'Approved' }
                : {
                    status: 'neutral',
                    label: ticket.resolution ? RESOLUTION_LABELS[ticket.resolution] : 'Closed',
                  },
      )
      break
  }
  return pills
}

export function headerChips(
  ticket: TicketRow,
  proposal: ProposalRow | null,
  actions: readonly EditableAction[],
  executions: readonly ActionExecutionRow[],
  now: Date,
): string[] {
  const chips: string[] = []
  if (ticket.dueDate) chips.push(`Due ${shortDate(`${ticket.dueDate}T12:00:00`, now)}`)
  if (ticket.status === 'needs_decision' && proposal && isRoutine(actions, ticket))
    chips.push('Routine')
  if (proposal?.customerConfirmationNeeded && proposal.stage === 1) chips.push('Stage 1 of 2')
  else if (ticket.stage === 2) chips.push('Stage 2 of 2')
  // When the execution started (the first action of the batch).
  const started = [...executions].map((e) => e.startedAt ?? e.createdAt).sort()[0]
  if (started && ticket.status !== 'waiting_on_customer' && ticket.status !== 'needs_decision')
    chips.push(`Executed ${ageShort(started, now)} ago`)
  return chips
}

export function riskEyebrow(ticket: TicketRow): string {
  const c = ticket.caseType ? caseShortLabel(ticket.caseType).toLowerCase() : ''
  if (ticket.riskLevel === 'safety') return 'Safety · pinned, cannot be snoozed'
  return c ? `High risk · ${c}` : 'High risk'
}

// ---------------------------------------------------------------- research and provenance

const SOURCE_LONG: Record<string, string> = {
  stripe: 'Stripe billing',
  supabase: 'Supabase activity',
  vercel: 'Vercel logs',
  kb: 'the knowledge base',
  linear: 'Linear',
  email: 'the email history',
  notion: 'Notion',
  ticket: 'the ticket history',
}

/** "Prepared by AnastasAI from Stripe billing, Supabase activity and the email history". */
export function provenanceLine(proposal: Pick<ProposalRow, 'research' | 'reply'>): string {
  const kinds: string[] = []
  for (const r of proposal.research)
    for (const s of r.sources) if (!kinds.includes(s.kind)) kinds.push(s.kind)
  const words = kinds.map((k) => SOURCE_LONG[k] ?? k)
  // The template is named when there is room for it; with many sources it lives in the reply draft.
  if (proposal.reply?.template && words.length <= 2)
    words.push(`the ${proposal.reply.template.replace(/\s*\(.*\)$/, '').toLowerCase()} template`)
  if (words.length === 0) return 'Prepared by AnastasAI'
  return `Prepared by AnastasAI from ${joinWords(words)}`
}

/** "4 sources · 22s" */
export function researchMeta(
  proposal: Pick<ProposalRow, 'research' | 'id'>,
  runs: readonly { proposalId: string | null; durationMs: number | null }[],
): string {
  const kinds = new Set<string>()
  for (const r of proposal.research) for (const s of r.sources) kinds.add(s.kind)
  const run = runs.find((r) => r.proposalId === proposal.id) ?? runs[0]
  const parts = [plural(kinds.size, 'source')]
  if (run?.durationMs != null) parts.push(`${Math.max(1, Math.round(run.durationMs / 1000))}s`)
  return parts.join(' · ')
}

/** Where a source chip opens: Stripe, Notion, Linear or the ticket. */
export function sourceLink(s: SourceChip): { href?: string; to?: string } {
  if (s.url) return { href: s.url }
  const ref = s.ref?.trim()
  if (!ref) return {}
  switch (s.kind) {
    case 'stripe':
      return { href: `https://dashboard.stripe.com/search?query=${encodeURIComponent(ref)}` }
    case 'linear':
      return { href: `https://linear.app/instaradar/issue/${encodeURIComponent(ref)}` }
    case 'kb':
    case 'notion':
      return /^[0-9a-f-]{32,36}$/i.test(ref) ? { href: notionPageUrl(ref) } : {}
    case 'email':
    case 'ticket': {
      const m = /^#?(\d{3,6})$/.exec(ref)
      return m ? { to: `/anastasai/t/${m[1]}` } : {}
    }
    default:
      return {}
  }
}

export function hasEvidence(r: ResearchItem): boolean {
  return r.evidence.length > 0
}

// ---------------------------------------------------------------- outcome and toast

/** "Created Linear ticket INS-214", "Refunded $13.07", "Sent reply", … */
export function pastTense(e: {
  type: ActionType
  params: Record<string, unknown>
  result?: unknown
  externalRefs?: Record<string, string>
}): string {
  const p = e.params ?? {}
  const refs = e.externalRefs ?? {}
  const result = (e.result ?? {}) as Record<string, unknown>
  switch (e.type) {
    case 'cancel_at_period_end':
      return 'Cancelled at period end'
    case 'cancel_immediately':
      return 'Cancelled immediately'
    case 'refund_latest_payment':
      return typeof p.amountCents === 'number'
        ? `Refunded ${money(p.amountCents, String(p.currency ?? 'usd'))}`
        : 'Refunded the latest payment'
    case 'delete_account':
      return 'Deleted the account'
    case 'stop_failed_payment_retries':
      return 'Stopped failed-payment retries'
    case 'create_coupon':
      return 'Created coupon'
    case 'create_linear_ticket': {
      const id =
        refs.linearIssue ??
        (result.identifier as string | undefined) ??
        (p.existingIssueIdentifier as string | undefined)
      const linked = result.linked === true || Boolean(p.existingIssueIdentifier)
      return `${linked ? 'Linked' : 'Created'} Linear ticket${id ? ` ${id}` : ''}`
    }
    case 'store_release_notification_email':
      return 'Stored email for release notification'
    case 'store_cancellation_reason':
      return 'Stored cancellation reason'
    case 'remove_from_tracking':
      return 'Removed from tracking'
    case 'send_reply':
      return 'Sent reply'
    default:
      return ACTIONS[e.type as ActionType]?.label ?? String(e.type)
  }
}

/** Toast lines after an approval, one per action that ran (queued ones say so). */
export function toastLines(
  executions: readonly ExecutionSummary[],
  actions: readonly Pick<EditableAction, 'type' | 'params'>[],
): string[] {
  return executions
    .filter((e) => e.status !== 'cancelled')
    .map((e) => {
      const a = actions.find((x) => x.type === e.type)
      const line = pastTense({ type: e.type, params: a?.params ?? {}, result: e.result })
      if (e.status === 'queued' || e.status === 'scheduled')
        return `${ACTIONS[e.type].label} · waits for the customer`
      if (e.status === 'failed') return `${ACTIONS[e.type].label} · failed`
      if (e.status === 'held') return `${ACTIONS[e.type].label} · held back`
      return line
    })
}

export function toastTitle(
  ticket: Pick<TicketRow, 'displayNumber' | 'customerName' | 'customerEmail'>,
  word = 'done',
): string {
  return `#${ticket.displayNumber} ${ticket.customerName ?? ticket.customerEmail} · ${word}`
}

/** What the closed ticket did, from the audit log. */
export function outcomeLines(detail: Pick<TicketDetailResponse, 'executions'>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of [...detail.executions].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (e.status !== 'succeeded' || seen.has(e.type)) continue
    seen.add(e.type)
    out.push(pastTense(e))
  }
  return out
}
