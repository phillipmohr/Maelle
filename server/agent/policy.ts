/**
 * Policy guardrails in code. The model proposes; these functions raise the risk floor, extract
 * deadlines and add policy warnings the UI shows. They never lower a risk the model set and they
 * never remove an action: the human decides.
 */
import { ACTIONS } from '#shared/actions'
import { CASE_TYPES, type CaseType, type RiskLevel } from '#shared/case-types'
import type { Proposal } from '#shared/proposal'
import { longDate } from './context'
import type { CustomerFacts } from './context'
import { money } from './attachments/stripe-timeline'
import type { ConfirmationSignal } from './types'

const RISK_RANK: Record<RiskLevel, number> = { none: 0, high: 1, safety: 2 }
const DAY = 86_400_000

export const LEGAL_THREAT_RE =
  /\b(lawyer|attorney|solicitor|legal action|legal steps|take (you|this) to court|sue you|lawsuit|small claims|consumer protection|trading standards|better business bureau|\bbbb\b|report (you|this) to (my|the) bank|chargeback|charge ?back|dispute (this|the|these) charges?|disputed? (with|through) (my|the) bank|file a dispute|fraud(ulent)? charge|ftc|attorney general)\b/i

export const VAGUE_REASON_RE =
  /\b(inaccurate|not accurate|not what i expected|isn'?t what i expected|wasn'?t what i expected|stopped working|doesn'?t work|does not work|didn'?t work|not working|useless|doesn'?t do what|not as described|misleading)\b/i

/** Cases where a long-term customer with a problem deserves high risk (fast, careful handling). */
const ISSUE_CASES: ReadonlySet<CaseType> = new Set<CaseType>([
  'bug_report',
  'unsatisfied_customer',
  'outage_access',
  'data_accuracy',
  'charged_after_cancellation',
  'billing_question',
  'second_refund_request',
  'cannot_cancel',
])

const REFUND_ACTIONS = new Set(['refund_latest_payment'])

export interface PolicyContext {
  caseType: CaseType
  facts: CustomerFacts
  /** All inbound customer text (translations preferred), newest last. */
  customerText: string
  /** The latest inbound message only. */
  latestCustomerText: string
  receivedAt: string
  now: Date
  confirmation: ConfirmationSignal
}

// ---------------------------------------------------------------- due dates

const MONTH_RE =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}
const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  fourteen: 14,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  a: 1,
  an: 1,
}

function addDays(from: Date, days: number, business: boolean): Date {
  const d = new Date(from.getTime())
  if (!business) return new Date(d.getTime() + days * DAY)
  let left = days
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) left--
  }
  return d
}

/** Finds a deadline in a customer or bank message ("within 10 days", "by October 7"). ISO date or null. */
export function extractDueDate(text: string, receivedAt: string): string | null {
  const base = new Date(receivedAt)
  const t = text.replace(/\s+/g, ' ')
  const within =
    /\bwithin (?:the next )?(\d{1,3}|[a-z]+) (business |working |calendar )?(day|week)s?\b/i.exec(t)
  if (within) {
    const n = /^\d+$/.test(within[1]!) ? Number(within[1]) : WORD_NUMBERS[within[1]!.toLowerCase()]
    if (n && n <= 365) {
      const days = within[3]!.toLowerCase() === 'week' ? n * 7 : n
      const business = /business|working/i.test(within[2] ?? '')
      return addDays(base, days, business).toISOString().slice(0, 10)
    }
  }
  const iso =
    /\b(?:by|before|until|no later than|deadline(?: is)?|due(?: on| by)?)\s+(\d{4}-\d{2}-\d{2})\b/i.exec(
      t,
    )
  if (iso) return iso[1]!
  const named = new RegExp(
    `\\b(?:by|before|until|no later than|deadline(?: is)?|due(?: on| by)?|prior to)\\s+(?:the )?(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}|${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?)(?:,?\\s+(\\d{4}))?\\b`,
    'i',
  ).exec(t)
  if (named) {
    const day = Number(named[1] ?? named[4])
    const monthWord = (named[2] ?? named[3] ?? '').toLowerCase().slice(0, 3)
    const month = MONTH_INDEX[monthWord]
    if (month !== undefined && day >= 1 && day <= 31) {
      let year = named[5] ? Number(named[5]) : base.getUTCFullYear()
      let d = new Date(Date.UTC(year, month, day))
      if (!named[5] && d.getTime() < base.getTime() - 2 * DAY) {
        year += 1
        d = new Date(Date.UTC(year, month, day))
      }
      return d.toISOString().slice(0, 10)
    }
  }
  return null
}

// ---------------------------------------------------------------- risk

export function applyRiskPolicy(
  risk: Proposal['risk'],
  ctx: PolicyContext,
): { risk: Proposal['risk']; notes: string[] } {
  const notes: string[] = []
  let level: RiskLevel = risk.level
  let reason = risk.reason
  const raise = (to: RiskLevel, why: string) => {
    if (RISK_RANK[to] > RISK_RANK[level]) {
      level = to
      reason = why
      notes.push(`Risk raised to ${to}: ${why}`)
    } else if (!reason) {
      reason = why
    }
  }
  if (ctx.caseType === 'safety_removal')
    raise('safety', 'Safety / removal request: act immediately, no research delay.')
  if (ctx.caseType === 'chargeback')
    raise('high', 'Bank dispute: the reply is evidence, review the wording and the timeline.')
  if (ctx.facts.openDisputes.length > 0)
    raise(
      'high',
      `${ctx.facts.openDisputes.length} open Stripe dispute${ctx.facts.openDisputes.length === 1 ? '' : 's'} on this customer.`,
    )
  if (LEGAL_THREAT_RE.test(ctx.customerText))
    raise('high', 'The customer mentions a bank dispute or legal steps.')
  if (ctx.facts.isLongTerm && ISSUE_CASES.has(ctx.caseType))
    raise(
      'high',
      `Long-term customer (${ctx.facts.customerDays} days) with an issue: act fast, consider a goodwill gesture.`,
    )
  const dueDate = risk.dueDate ?? extractDueDate(ctx.latestCustomerText, ctx.receivedAt)
  if (!risk.dueDate && dueDate) notes.push(`Due date ${dueDate} extracted from the message.`)
  return { risk: { level, reason: reason ?? null, dueDate }, notes }
}

// ---------------------------------------------------------------- policy warnings

export function policyWarnings(
  proposal: Pick<Proposal, 'case' | 'actions' | 'reply' | 'customerConfirmationNeeded' | 'stage'>,
  ctx: PolicyContext,
): string[] {
  const warnings: string[] = []
  const enabled = proposal.actions.filter((a) => a.enabled)
  const has = (type: string) => enabled.some((a) => a.type === type)
  const facts = ctx.facts
  const latest = facts.latestPayment
  const refund = enabled.find((a) => REFUND_ACTIONS.has(a.type))

  if (refund) {
    const params = refund.params as Record<string, unknown>
    if (latest && facts.daysSinceLatestPayment != null && facts.daysSinceLatestPayment > 30)
      warnings.push(
        `Refund outside the 30-day window: the latest payment (${money(latest.amountCents, latest.currency)} on ${longDate(latest.date)}) is ${facts.daysSinceLatestPayment} days old.`,
      )
    const target = (params.stripePaymentIntentId ?? params.stripeChargeId) as string | undefined
    if (latest && target && target !== latest.chargeId && target !== latest.paymentIntentId)
      warnings.push(
        `The refund targets ${target}, but the latest payment is ${latest.paymentIntentId ?? latest.chargeId} (${money(latest.amountCents, latest.currency)} on ${longDate(latest.date)}). Only the latest payment is refundable.`,
      )
    if (facts.refundCount > 0) {
      const last = facts.refunds[0]!
      warnings.push(
        `Second refund: this customer already received a refund (${money(last.amountCents, last.currency)} on ${longDate(last.created)}). A second refund needs a valid reason, for example a technical issue that was looked into.`,
      )
    }
    if (
      latest &&
      typeof params.amountCents === 'number' &&
      params.amountCents !== latest.amountCents
    )
      warnings.push(
        `Partial refund: ${money(params.amountCents, latest.currency)} of the ${money(latest.amountCents, latest.currency)} payment on ${longDate(latest.date)}.`,
      )
    if (facts.latestChargeDisputed)
      warnings.push(
        'The latest charge is disputed; Stripe does not refund a disputed charge while the dispute is open.',
      )
    if (!latest && facts.stripeCustomerId)
      warnings.push('Refund proposed but no successful payment was found in Stripe.')
  }

  const deletion = enabled.find((a) => a.type === 'delete_account')
  if (deletion) {
    const cancelBefore = enabled.some(
      (a) =>
        (a.type === 'cancel_immediately' || a.type === 'cancel_at_period_end') &&
        ACTIONS[a.type].order < ACTIONS.delete_account.order,
    )
    const subscriptionActive =
      facts.activeSubscription != null &&
      !['canceled', 'incomplete_expired'].includes(facts.activeSubscription.status)
    if (subscriptionActive && !cancelBefore)
      warnings.push(
        `Account deletion without prior cancellation: the ${facts.plan ?? ''} subscription is still ${facts.activeSubscription!.status} and no cancellation runs before it.`,
      )
    if (deletion.stage === 'now' && ctx.confirmation !== 'confirmed')
      warnings.push('Account deletion without an explicit customer confirmation in the thread.')
  }

  const cancellationCases: CaseType[] = [
    'cancellation_only',
    'cancellation_reason_ask',
    'cannot_cancel',
  ]
  const mentionsRefund = /\brefund|money back|reimburse|charge ?back/i.test(ctx.customerText)
  if (
    has('cancel_immediately') &&
    !refund &&
    (cancellationCases.includes(proposal.case) || !mentionsRefund)
  )
    warnings.push(
      'The customer asked to cancel, not for a refund: cancel at period end instead of immediately (immediate cancellation deletes the tracked profiles).',
    )

  const vague = VAGUE_REASON_RE.exec(ctx.latestCustomerText)
  if (vague) {
    const asksFirst = proposal.reply
      ? /\?/.test(proposal.reply.body) &&
        /what|which|where|tell me|let me know|could you/i.test(proposal.reply.body)
      : false
    if (refund || !asksFirst)
      warnings.push(
        `The reason is vague ("${vague[0]}"): ask what exactly seemed off and where before refunding or explaining.`,
      )
  }

  if (proposal.customerConfirmationNeeded && proposal.stage === 1) {
    const irreversibleNow = enabled.filter((a) => ACTIONS[a.type].irreversible && a.stage === 'now')
    if (irreversibleNow.length)
      warnings.push(
        `Irreversible actions proposed to run now although the customer has not confirmed: ${irreversibleNow.map((a) => ACTIONS[a.type].label).join(', ')}.`,
      )
  }

  const def = CASE_TYPES[proposal.case]
  if (def.requiresConfirmation && proposal.stage === 2 && ctx.confirmation !== 'confirmed')
    warnings.push(
      'Stage 2 proposed, but no explicit customer confirmation was detected in the thread. Check the latest message before approving.',
    )

  return [...new Set(warnings)]
}
