/**
 * Editable parameters per action, for the checklist's inline editor and the manual composer. Ids
 * (Stripe, InstaRadar, positions) are never edited by hand; everything else is a small typed field.
 * Validation goes through the registry's zod schemas.
 */
import {
  safeParseActionParams,
  STRIPE_CANCELLATION_FEEDBACK,
  type ActionType,
} from '#shared/actions'

export type ParamFieldKind = 'text' | 'number' | 'money' | 'date' | 'email' | 'select' | 'boolean'

export interface ParamField {
  key: string
  label: string
  kind: ParamFieldKind
  options?: { value: string; label: string }[]
  placeholder?: string
}

const feedbackOptions = STRIPE_CANCELLATION_FEEDBACK.map((v) => ({
  value: v,
  label: v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
}))

const FIELDS: Record<ActionType, ParamField[]> = {
  cancel_at_period_end: [{ key: 'accessUntil', label: 'Access until', kind: 'date' }],
  cancel_immediately: [],
  refund_latest_payment: [
    { key: 'amountCents', label: 'Amount', kind: 'money' },
    {
      key: 'reason',
      label: 'Reason',
      kind: 'select',
      options: [
        { value: 'requested_by_customer', label: 'Requested by customer' },
        { value: 'duplicate', label: 'Duplicate' },
        { value: 'fraudulent', label: 'Fraudulent' },
      ],
    },
  ],
  delete_account: [{ key: 'email', label: 'Email', kind: 'email' }],
  stop_failed_payment_retries: [],
  create_coupon: [
    {
      key: 'kind',
      label: 'Kind',
      kind: 'select',
      options: [
        { value: 'percent', label: 'Percent off' },
        { value: 'amount', label: 'Amount off' },
      ],
    },
    { key: 'percentOff', label: 'Percent off', kind: 'number' },
    { key: 'amountOffCents', label: 'Amount off', kind: 'money' },
    {
      key: 'duration',
      label: 'Duration',
      kind: 'select',
      options: [
        { value: 'once', label: 'Once' },
        { value: 'repeating', label: 'Repeating' },
        { value: 'forever', label: 'Forever' },
      ],
    },
    { key: 'durationInMonths', label: 'Months', kind: 'number' },
    {
      key: 'applyTo',
      label: 'Apply to',
      kind: 'select',
      options: [
        { value: 'subscription', label: 'The subscription' },
        { value: 'promotion_code', label: 'A promotion code in the reply' },
      ],
    },
    { key: 'name', label: 'Name', kind: 'text', placeholder: 'Shown on the invoice' },
  ],
  create_linear_ticket: [
    { key: 'title', label: 'Title', kind: 'text' },
    {
      key: 'label',
      label: 'Label',
      kind: 'select',
      options: [
        { value: 'Bug', label: 'Bug' },
        { value: 'Feature', label: 'Feature' },
      ],
    },
    {
      key: 'existingIssueIdentifier',
      label: 'Link existing issue',
      kind: 'text',
      placeholder: 'INS-198',
    },
    { key: 'description', label: 'Description', kind: 'text' },
    { key: 'customerEmail', label: 'Customer email', kind: 'email' },
  ],
  store_release_notification_email: [
    { key: 'linearIssueIdentifier', label: 'Linear issue', kind: 'text', placeholder: 'INS-198' },
    { key: 'email', label: 'Email', kind: 'email' },
  ],
  store_cancellation_reason: [
    { key: 'feedback', label: 'Category', kind: 'select', options: feedbackOptions },
    { key: 'comment', label: 'Verbatim reason', kind: 'text' },
  ],
  remove_from_tracking: [
    { key: 'instagramHandle', label: 'Instagram handle', kind: 'text', placeholder: '@handle' },
    { key: 'reason', label: 'Reason', kind: 'text' },
  ],
  send_reply: [
    { key: 'to', label: 'To', kind: 'email' },
    { key: 'includeAttachments', label: 'Include attachments', kind: 'boolean' },
  ],
}

export function paramFields(type: ActionType): ParamField[] {
  return FIELDS[type]
}

/** First validation problem in plain words, or null. */
export function paramsProblem(type: ActionType, params: Record<string, unknown>): string | null {
  const r = safeParseActionParams(type, params)
  if (r.success) return null
  const issue = r.error.issues[0]
  if (!issue) return 'Check the parameters'
  const path = issue.path.map(String).join('.')
  return path ? `${path}: ${issue.message}` : issue.message
}

/** Field value → stored value (money in cents, numbers as numbers, empty as undefined). */
export function coerceParam(field: ParamField, raw: string | boolean): unknown {
  if (field.kind === 'boolean') return Boolean(raw)
  const s = typeof raw === 'string' ? raw.trim() : String(raw)
  if (s === '') return undefined
  if (field.kind === 'money') {
    const n = Number(s.replace(/[^0-9.]/g, ''))
    return Number.isFinite(n) ? Math.round(n * 100) : undefined
  }
  if (field.kind === 'number') {
    const n = Number(s)
    return Number.isFinite(n) ? n : undefined
  }
  return s
}

/** Stored value → field value for the input. */
export function paramInputValue(field: ParamField, v: unknown): string {
  if (v == null) return ''
  if (field.kind === 'money' && typeof v === 'number') return (v / 100).toFixed(2)
  return String(v)
}
