/**
 * Case types. The 17 cases of the Notion Templates DB plus `release_notification` and `unclear`.
 *
 * `key` is what the database, the agent output and the API use. `label` is the exact name of the
 * Notion template (source of truth), `shortLabel` is what the UI shows in tight spaces.
 *
 * Templates DB: https://app.notion.com/p/3e8c931f6ae580de886be918fc7efd43
 * (collection://3e8c931f-6ae5-8071-98a0-000befdd6354)
 */
import type { ActionType } from './actions'

export const NOTION = {
  customerSupportPageId: '3e8c931f6ae58012a0a7ec9a1adb4259',
  templatesDatabaseId: '3e8c931f6ae580de886be918fc7efd43',
  templatesCollectionId: '3e8c931f-6ae5-8071-98a0-000befdd6354',
  examplesDatabaseId: '3e8c931f6ae58088a039ceff771f911d',
  examplesCollectionId: '3e8c931f-6ae5-801d-a2f5-000b1ba7f580',
  knowledgeBaseDatabaseId: '3e8c931f6ae5809fa298d3a8bab0baf9',
  knowledgeBaseCollectionId: '3e8c931f-6ae5-80fb-9152-000bf28ecfbd',
} as const

export function notionPageUrl(pageId: string): string {
  return `https://app.notion.com/p/${pageId.replace(/-/g, '')}`
}

export type RiskLevel = 'none' | 'high' | 'safety'
export const RISK_LEVELS = ['none', 'high', 'safety'] as const satisfies readonly RiskLevel[]

export type ResearchSource = 'stripe' | 'supabase' | 'vercel' | 'kb' | 'linear' | 'email'
export const RESEARCH_SOURCES = ['stripe', 'supabase', 'vercel', 'kb', 'linear', 'email'] as const

export interface CaseTypeDefinition {
  key: CaseType
  /** Exact Notion template name. */
  label: string
  /** Short label for lists and pills. */
  shortLabel: string
  /** Notion page id of the template (null for the two synthetic cases). */
  notionPageId: string | null
  /** What the customer says or requests that triggers this case (from Notion). */
  trigger: string
  /** Executable actions the template lists, in registry order. Send reply is always last. */
  defaultActions: readonly ActionType[]
  /** The customer must confirm before irreversible actions run (two-stage flow). */
  requiresConfirmation: boolean
  /** Risk level the case carries by default; the agent may raise it. */
  defaultRisk: RiskLevel
  /** Research the template asks for. */
  research: readonly ResearchSource[]
}

export const CASE_TYPE_KEYS = [
  'cancellation_only',
  'cancellation_reason_ask',
  'refund_request',
  'cancellation_refund_deletion',
  'account_deletion',
  'second_refund_request',
  'feature_request',
  'bug_report',
  'unsatisfied_customer',
  'billing_question',
  'chargeback',
  'charged_after_cancellation',
  'product_question',
  'data_accuracy',
  'safety_removal',
  'outage_access',
  'cannot_cancel',
  'release_notification',
  'unclear',
] as const

export type CaseType = (typeof CASE_TYPE_KEYS)[number]

/** The 17 Notion template cases (excludes the two synthetic ones). */
export type TemplateCaseType = Exclude<CaseType, 'release_notification' | 'unclear'>

export const CASE_TYPES: Record<CaseType, CaseTypeDefinition> = {
  cancellation_only: {
    key: 'cancellation_only',
    label: 'Cancellation only',
    shortLabel: 'Cancellation only',
    notionPageId: '3e8c931f6ae581429b0ecd9c9abee871',
    trigger: 'Customer wants to cancel their subscription (no refund mentioned).',
    defaultActions: ['cancel_at_period_end', 'store_cancellation_reason', 'send_reply'],
    requiresConfirmation: false,
    defaultRisk: 'none',
    research: ['stripe'],
  },
  cancellation_reason_ask: {
    key: 'cancellation_reason_ask',
    label: 'Cancellation + reason ask',
    shortLabel: 'Cancellation + reason ask',
    notionPageId: '3e8c931f6ae58147b800e658bf20d6d7',
    trigger: 'Customer cancels and we want to learn why (feedback).',
    defaultActions: ['cancel_at_period_end', 'store_cancellation_reason', 'send_reply'],
    requiresConfirmation: false,
    defaultRisk: 'none',
    research: ['stripe'],
  },
  refund_request: {
    key: 'refund_request',
    label: 'Refund request (latest payment)',
    shortLabel: 'Refund request',
    notionPageId: '3e8c931f6ae58118a872c601963e97c1',
    trigger: 'Customer requests a refund. Implies immediate cancellation and full data loss.',
    defaultActions: ['refund_latest_payment', 'cancel_immediately', 'send_reply'],
    requiresConfirmation: true,
    defaultRisk: 'none',
    research: ['stripe', 'supabase'],
  },
  cancellation_refund_deletion: {
    key: 'cancellation_refund_deletion',
    label: 'Cancellation + refund + account deletion',
    shortLabel: 'Cancel + refund + delete',
    notionPageId: '3e8c931f6ae58182b5d7efa7ab6c6904',
    trigger: 'Customer wants to cancel, get a refund, and delete their account entirely.',
    defaultActions: ['refund_latest_payment', 'cancel_immediately', 'delete_account', 'send_reply'],
    requiresConfirmation: true,
    defaultRisk: 'none',
    research: ['stripe', 'supabase'],
  },
  account_deletion: {
    key: 'account_deletion',
    label: 'Account deletion request',
    shortLabel: 'Account deletion',
    notionPageId: '3e8c931f6ae581cab33bf43aa4d9f8bb',
    trigger: 'Customer asks to delete/terminate their account. Requires cancellation first.',
    defaultActions: ['cancel_immediately', 'delete_account', 'send_reply'],
    requiresConfirmation: true,
    defaultRisk: 'none',
    research: ['stripe', 'supabase'],
  },
  second_refund_request: {
    key: 'second_refund_request',
    label: 'Second refund request (needs reason)',
    shortLabel: 'Second refund request',
    notionPageId: '3e8c931f6ae58171ad14ff06d294b020',
    trigger:
      'Customer requests a refund but already received one before. Needs a valid reason (e.g. technical issue) before deciding.',
    defaultActions: ['send_reply'],
    requiresConfirmation: false,
    defaultRisk: 'none',
    research: ['stripe', 'supabase', 'email'],
  },
  feature_request: {
    key: 'feature_request',
    label: 'Feature request / feedback',
    shortLabel: 'Feature request',
    notionPageId: '3e8c931f6ae581988be7cd93f5d89fd8',
    trigger: 'Customer suggests a feature or sends product feedback.',
    defaultActions: ['create_linear_ticket', 'store_release_notification_email', 'send_reply'],
    requiresConfirmation: false,
    defaultRisk: 'none',
    research: ['linear'],
  },
  bug_report: {
    key: 'bug_report',
    label: 'Bug report',
    shortLabel: 'Bug report',
    notionPageId: '3e8c931f6ae58114beabdeaddfaca242',
    trigger: 'Customer reports something not working correctly.',
    defaultActions: ['create_linear_ticket', 'store_release_notification_email', 'send_reply'],
    requiresConfirmation: false,
    defaultRisk: 'none',
    research: ['kb', 'stripe', 'supabase', 'vercel', 'linear'],
  },
  unsatisfied_customer: {
    key: 'unsatisfied_customer',
    label: 'Unsatisfied customer (dissatisfaction)',
    shortLabel: 'Unsatisfied customer',
    notionPageId: '3e8c931f6ae58196b94de87d3d15c5e7',
    trigger:
      'Customer is unhappy or experienced an issue; we want to retain them with a goodwill gesture.',
    defaultActions: ['create_coupon', 'send_reply'],
    requiresConfirmation: false,
    defaultRisk: 'none',
    research: ['stripe', 'supabase', 'vercel'],
  },
  billing_question: {
    key: 'billing_question',
    label: 'Billing question / disputed charge',
    shortLabel: 'Billing question',
    notionPageId: '3e8c931f6ae581c894b8dd9ef534d00f',
    trigger:
      'Customer questions a charge or thinks they were billed incorrectly (e.g. multiple charges, catch-up payments).',
    defaultActions: ['send_reply'],
    requiresConfirmation: false,
    defaultRisk: 'none',
    research: ['stripe', 'supabase'],
  },
  chargeback: {
    key: 'chargeback',
    label: 'Chargeback / bank dispute',
    shortLabel: 'Chargeback / bank dispute',
    notionPageId: '3e8c931f6ae5813c8558f2c0427a6037',
    trigger: "A bank or credit union contacts us about a disputed charge on the customer's behalf.",
    defaultActions: ['send_reply'],
    requiresConfirmation: false,
    defaultRisk: 'high',
    research: ['stripe', 'supabase', 'email'],
  },
  charged_after_cancellation: {
    key: 'charged_after_cancellation',
    label: 'Charged after cancellation attempt',
    shortLabel: 'Charged after cancellation',
    notionPageId: '3e8c931f6ae5810cb4cdfe335562081b',
    trigger:
      'Customer says they were charged after cancelling, or a failed payment went through after the subscription was already inactive.',
    defaultActions: ['stop_failed_payment_retries', 'refund_latest_payment', 'send_reply'],
    requiresConfirmation: false,
    defaultRisk: 'none',
    research: ['stripe', 'supabase'],
  },
  product_question: {
    key: 'product_question',
    label: 'Product question (general)',
    shortLabel: 'Product question',
    notionPageId: '3e8c931f6ae58193a3cdd3f12050625a',
    trigger:
      'Customer asks how something works (private profiles, timestamps, scan frequency, chronological order, etc.).',
    defaultActions: ['send_reply'],
    requiresConfirmation: false,
    defaultRisk: 'none',
    research: ['kb'],
  },
  data_accuracy: {
    key: 'data_accuracy',
    label: 'Data accuracy concern',
    shortLabel: 'Data accuracy',
    notionPageId: '3e8c931f6ae581f3b55be4fc0ebd1597',
    trigger:
      'Customer thinks the follower/following data or count is wrong; ask what and where before explaining.',
    defaultActions: ['send_reply'],
    requiresConfirmation: false,
    defaultRisk: 'none',
    research: ['kb', 'supabase', 'vercel'],
  },
  safety_removal: {
    key: 'safety_removal',
    label: 'Safety / removal request',
    shortLabel: 'Safety / removal',
    notionPageId: '3e8c931f6ae581ba81e9ee845e3ed1d5',
    trigger:
      'Customer reports safety concerns, stalking, or threats and asks to be removed from the platform.',
    defaultActions: ['remove_from_tracking', 'send_reply'],
    requiresConfirmation: false,
    defaultRisk: 'safety',
    research: ['supabase'],
  },
  outage_access: {
    key: 'outage_access',
    label: 'Outage / access issue',
    shortLabel: 'Outage / access',
    notionPageId: '3e8c931f6ae5810fa4f4e479c2f418de',
    trigger:
      "Customer can't load profiles or access their account due to a temporary technical issue.",
    defaultActions: ['send_reply'],
    requiresConfirmation: false,
    defaultRisk: 'none',
    research: ['kb', 'stripe', 'supabase', 'vercel'],
  },
  cannot_cancel: {
    key: 'cannot_cancel',
    label: 'Cannot cancel (missing button)',
    shortLabel: 'Cannot cancel',
    notionPageId: '3e8c931f6ae5814c9db2cc7b24311637',
    trigger: "Customer can't find where to cancel and wants help ending their subscription.",
    defaultActions: ['cancel_at_period_end', 'store_cancellation_reason', 'send_reply'],
    requiresConfirmation: false,
    defaultRisk: 'none',
    research: ['kb', 'stripe', 'supabase'],
  },
  release_notification: {
    key: 'release_notification',
    label: 'Release notification',
    shortLabel: 'Release notification',
    notionPageId: null,
    trigger:
      'A Linear issue with stored customer emails was completed. Tell the customer that their bug fix or feature is live.',
    defaultActions: ['send_reply'],
    requiresConfirmation: false,
    defaultRisk: 'none',
    research: ['linear', 'email'],
  },
  unclear: {
    key: 'unclear',
    label: 'Unclear',
    shortLabel: 'Unclear',
    notionPageId: null,
    trigger:
      'Classification confidence below threshold. The user picks the case from the candidates.',
    defaultActions: [],
    requiresConfirmation: false,
    defaultRisk: 'none',
    research: [],
  },
}

export const CASE_TYPE_LIST: readonly CaseTypeDefinition[] = CASE_TYPE_KEYS.map(
  (k) => CASE_TYPES[k],
)

/** The 17 template cases in Notion order of relevance (as listed in the ticket). */
export const TEMPLATE_CASE_TYPES: readonly TemplateCaseType[] = CASE_TYPE_KEYS.filter(
  (k): k is TemplateCaseType => k !== 'release_notification' && k !== 'unclear',
)

export function isCaseType(value: unknown): value is CaseType {
  return typeof value === 'string' && (CASE_TYPE_KEYS as readonly string[]).includes(value)
}

export function caseLabel(key: CaseType): string {
  return CASE_TYPES[key].label
}

export function caseShortLabel(key: CaseType): string {
  return CASE_TYPES[key].shortLabel
}

/** Resolve a Notion template name (or a short label) back to its key. */
export function caseTypeFromLabel(label: string): CaseType | undefined {
  const norm = label.trim().toLowerCase()
  return CASE_TYPE_LIST.find(
    (c) => c.label.toLowerCase() === norm || c.shortLabel.toLowerCase() === norm,
  )?.key
}

/** Classification confidence below this value makes a case `unclear`. */
export const UNCLEAR_CONFIDENCE_THRESHOLD = 0.6
