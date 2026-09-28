/**
 * Consistency check between the reply text and the enabled actions (the UI calls it after edits).
 * Deterministic rules always run; the small model adds judgement when a key exists. Mismatches are
 * merged and deduplicated.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { ACTION_TYPES, ACTIONS, type ActionType } from '#shared/actions'
import type { ConsistencyCheckRequest, ConsistencyCheckResponse } from '#shared/api'
import { EM_DASH_RE } from '#shared/proposal'
import type { ModelClient } from './model/types'

type Mismatch = ConsistencyCheckResponse['mismatches'][number]

interface Rule {
  /** The reply claims this happened / will happen. */
  claims: RegExp
  /** Any of these actions backs the claim. */
  actions: ActionType[]
  label: string
  /** Report the reverse too: action on but the reply never mentions it. */
  reverse?: { mention: RegExp; severity: Mismatch['severity'] }
  severity?: Mismatch['severity']
}

const RULES: Rule[] = [
  {
    claims:
      /\b(i('ve| have)|we('ve| have)) (already )?refunded|refund (is|has been|was) (processed|issued|sent)|i('ll| will) (process|issue) (the|your) refund|(i'd|i would) be happy to refund|will refund|refund (of|for) (your|the)|\brefunded\b/i,
    actions: ['refund_latest_payment'],
    label: 'a refund',
    severity: 'error',
    reverse: { mention: /\brefund/i, severity: 'warning' },
  },
  {
    claims:
      /\b(i('ve| have)|we('ve| have)) cancelled|i cancelled|(is|has been|was) (now )?cancelled|cancel(s|led)? your subscription immediately|i('ll| will) cancel/i,
    actions: ['cancel_at_period_end', 'cancel_immediately'],
    label: 'a cancellation',
    severity: 'error',
    reverse: { mention: /\bcancel/i, severity: 'warning' },
  },
  {
    claims: /\bcoupon\b|\bdiscount\b|free month|\bpromo(tion)? code\b|% off|percent off/i,
    actions: ['create_coupon'],
    label: 'a coupon or discount',
    severity: 'error',
    reverse: {
      mention: /coupon|discount|free month|promo|% off|percent off/i,
      severity: 'warning',
    },
  },
  {
    claims:
      /let you know (personally )?(as soon as|when|once)|(email|notify|contact|update) you (personally )?(as soon as|when|once)|as soon as (it'?s|it is|the fix is|this is) live|when (it'?s|it is) live|hear from (me|us) (the moment|as soon as|when)/i,
    actions: ['store_release_notification_email'],
    label: 'a release notice',
    severity: 'error',
  },
  {
    claims:
      /passed (it|this) (on )?to (our )?(engineering|dev(elopment)?|product) team|added (it|this) to (our|the) roadmap|(engineering|dev) team (is|are) (looking|working|on it)|filed (a )?(bug|ticket|issue)|logged (this|it|the bug)/i,
    actions: ['create_linear_ticket'],
    label: 'a Linear ticket',
    severity: 'warning',
  },
  {
    claims:
      /removed your profile|can no longer be tracked|(blocked|removed) (it |your profile )?from (tracking|our platform|instaradar)|i('ve| have) removed/i,
    actions: ['remove_from_tracking'],
    label: 'a removal from tracking',
    severity: 'error',
  },
  {
    claims:
      /(i('ve| have)|we('ve| have)) deleted your account|account (is|has been|was) (now )?deleted|deleted your (account|data)|i('ll| will) delete (your|the) account/i,
    actions: ['delete_account'],
    label: 'an account deletion',
    severity: 'error',
  },
  {
    claims:
      /stopped (all )?(further |future )?(payment|billing) (attempts|retries)|no further (payment )?attempts|stopped (the )?retries/i,
    actions: ['stop_failed_payment_retries'],
    label: 'stopping the payment retries',
    severity: 'error',
  },
]

function amountsIn(text: string): number[] {
  const out: number[] = []
  const re =
    /(?:\$|€|£|USD|EUR)\s?(\d{1,5}(?:[.,]\d{2})?)|(\d{1,5}(?:[.,]\d{2})?)\s?(?:\$|€|USD|EUR)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const raw = (m[1] ?? m[2] ?? '').replace(',', '.')
    const n = Number(raw)
    if (Number.isFinite(n)) out.push(Math.round(n * 100))
  }
  return out
}

export function ruleBasedConsistencyCheck(req: ConsistencyCheckRequest): Mismatch[] {
  const text = req.replyBody ?? ''
  const enabled = new Map<string, Record<string, unknown>>()
  for (const a of req.enabledActions ?? []) enabled.set(a.type, a.params ?? {})
  const out: Mismatch[] = []
  for (const rule of RULES) {
    const claimed = rule.claims.test(text)
    const backed = rule.actions.some((a) => enabled.has(a))
    if (claimed && !backed)
      out.push({
        severity: rule.severity ?? 'error',
        text: `The reply mentions ${rule.label} but the matching action is off.`,
      })
    if (rule.reverse && backed && !rule.reverse.mention.test(text)) {
      const on = rule.actions.filter((a) => enabled.has(a)).map((a) => ACTIONS[a].label)
      out.push({
        severity: rule.reverse.severity,
        text: `${on.join(' and ')} will run but the reply does not mention it.`,
      })
    }
  }
  const refund = enabled.get('refund_latest_payment')
  if (refund && typeof refund.amountCents === 'number') {
    const mentioned = amountsIn(text)
    if (mentioned.length > 0 && !mentioned.includes(refund.amountCents))
      out.push({
        severity: 'warning',
        text: `The reply mentions ${mentioned.map((c) => `$${(c / 100).toFixed(2)}`).join(', ')} but the refund action is for $${(refund.amountCents / 100).toFixed(2)}.`,
      })
  }
  const cancelEnd = enabled.get('cancel_at_period_end')
  if (
    cancelEnd &&
    /immediately|right away|effective immediately/i.test(text) &&
    /cancel/i.test(text)
  )
    out.push({
      severity: 'warning',
      text: 'The reply says the cancellation is immediate, but the action cancels at period end.',
    })
  if (
    enabled.has('cancel_immediately') &&
    /until (the end of|your current|the current) (billing )?period|keep (full )?access until/i.test(
      text,
    )
  )
    out.push({
      severity: 'error',
      text: 'The reply promises access until the period end, but the action cancels immediately.',
    })
  if (EM_DASH_RE.test(text)) out.push({ severity: 'error', text: 'The reply contains an em dash.' })
  if (enabled.has('send_reply') && text.trim().length === 0)
    out.push({ severity: 'error', text: 'Send reply is on but the reply is empty.' })
  return dedupe(out)
}

function dedupe(list: Mismatch[]): Mismatch[] {
  const seen = new Set<string>()
  return list.filter((m) => {
    const k = m.text.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

const REPORT_TOOL: Anthropic.Tool = {
  name: 'report_mismatches',
  description:
    'Report every mismatch between the reply text and the enabled actions. Empty list when consistent.',
  input_schema: {
    type: 'object',
    properties: {
      mismatches: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            severity: { type: 'string', enum: ['warning', 'error'] },
            text: { type: 'string', maxLength: 300 },
          },
          required: ['severity', 'text'],
          additionalProperties: false,
        },
      },
    },
    required: ['mismatches'],
    additionalProperties: false,
  },
}

export async function modelConsistencyCheck(
  req: ConsistencyCheckRequest,
  model: ModelClient,
  modelId: string,
): Promise<Mismatch[]> {
  const actions = (req.enabledActions ?? [])
    .filter((a) => (ACTION_TYPES as readonly string[]).includes(a.type))
    .map(
      (a) =>
        `- ${a.type} (${ACTIONS[a.type as ActionType].label}): ${JSON.stringify(a.params ?? {})}`,
    )
    .join('\n')
  const response = await model.create({
    model: modelId,
    max_tokens: 2_000,
    system:
      'You check a customer support reply against the actions that will actually run when it is sent. Report a mismatch when the reply promises, states or implies something no enabled action does (a refund, a cancellation, a deletion, a coupon, a release notice, a ticket, a removal), when an enabled action does something the reply does not tell the customer, or when amounts, dates, plan names or profiles in the reply contradict the action params. Severity error for promises without an action and contradictions, warning for omissions. Report through the report_mismatches tool only; an empty list means the reply is consistent.',
    tools: [REPORT_TOOL],
    tool_choice: { type: 'auto' },
    messages: [
      {
        role: 'user',
        content: `Enabled actions:\n${actions || '(none)'}\n\nReply:\n"""\n${req.replyBody}\n"""\n\nCall report_mismatches.`,
      },
    ],
  })
  const use = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'report_mismatches',
  )
  const list = (use?.input as { mismatches?: unknown[] } | undefined)?.mismatches ?? []
  return list
    .filter(
      (m): m is Mismatch =>
        !!m && typeof m === 'object' && typeof (m as Mismatch).text === 'string',
    )
    .map((m) => ({
      severity: m.severity === 'error' ? 'error' : 'warning',
      text: m.text.slice(0, 300),
    }))
}

export async function consistencyCheck(
  req: ConsistencyCheckRequest,
  deps: { model: ModelClient | null; modelId: string; timeoutMs?: number },
): Promise<ConsistencyCheckResponse> {
  const rules = ruleBasedConsistencyCheck(req)
  if (!deps.model || deps.model.kind === 'unavailable') return { mismatches: rules }
  try {
    const timeout = new Promise<Mismatch[]>((_, reject) =>
      setTimeout(() => reject(new Error('consistency model timeout')), deps.timeoutMs ?? 20_000),
    )
    const fromModel = await Promise.race([
      modelConsistencyCheck(req, deps.model, deps.modelId),
      timeout,
    ])
    return { mismatches: dedupe([...rules, ...fromModel]) }
  } catch {
    return { mismatches: rules }
  }
}
