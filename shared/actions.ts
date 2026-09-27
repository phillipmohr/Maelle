/**
 * Action registry. These 11 actions are the only actions that exist. The agent may only propose
 * them, the executor may only run them, the UI may only offer them.
 */
import { z } from 'zod'

export const ACTION_TYPES = [
  'cancel_at_period_end',
  'cancel_immediately',
  'refund_latest_payment',
  'delete_account',
  'stop_failed_payment_retries',
  'create_coupon',
  'create_linear_ticket',
  'store_release_notification_email',
  'store_cancellation_reason',
  'remove_from_tracking',
  'send_reply',
] as const

export type ActionType = (typeof ACTION_TYPES)[number]

export type ActionStage = 'now' | 'after_confirmation'
export const ACTION_STAGES = ['now', 'after_confirmation'] as const satisfies readonly ActionStage[]

/** Stripe `cancellation_details.feedback` categories. */
export const STRIPE_CANCELLATION_FEEDBACK = [
  'customer_service',
  'low_quality',
  'missing_features',
  'other',
  'switched_service',
  'too_complex',
  'too_expensive',
  'unused',
] as const
export type StripeCancellationFeedback = (typeof STRIPE_CANCELLATION_FEEDBACK)[number]

const isoDate = z.iso.date()
const email = z.email()
const money = z.number().int().nonnegative()
const currency = z
  .string()
  .length(3)
  .transform((s) => s.toLowerCase())

export const ACTION_PARAM_SCHEMAS = {
  cancel_at_period_end: z.object({
    stripeSubscriptionId: z.string().min(1),
    /** Informational: the date access ends, shown in the UI and the reply. */
    accessUntil: isoDate.optional(),
  }),
  cancel_immediately: z.object({
    stripeSubscriptionId: z.string().min(1),
    /** Number of tracked profiles that will be deleted (informational, for the confirm bar). */
    profilesAffected: z.number().int().nonnegative().optional(),
  }),
  refund_latest_payment: z.object({
    /** The latest successful payment. One of the two ids must be present. */
    stripePaymentIntentId: z.string().min(1).optional(),
    stripeChargeId: z.string().min(1).optional(),
    amountCents: z.number().int().positive(),
    currency: currency.default('usd'),
    /** Amount of the original payment, so a partial refund is visible as such. */
    paymentAmountCents: money.optional(),
    paymentDate: isoDate.optional(),
    /** Card brand and last 4 for the confirm note, e.g. "Visa ··2291". */
    cardLabel: z.string().optional(),
    reason: z
      .enum(['requested_by_customer', 'duplicate', 'fraudulent'])
      .default('requested_by_customer'),
  }),
  delete_account: z.object({
    instaradarUserId: z.string().min(1),
    email,
  }),
  stop_failed_payment_retries: z.object({
    stripeCustomerId: z.string().min(1),
    stripeSubscriptionId: z.string().min(1).optional(),
    /** Open invoices to stop collecting; the executor discovers them when omitted. */
    stripeInvoiceIds: z.array(z.string().min(1)).default([]),
  }),
  create_coupon: z.object({
    kind: z.enum(['percent', 'amount']),
    percentOff: z.number().min(1).max(100).optional(),
    amountOffCents: z.number().int().positive().optional(),
    currency: currency.optional(),
    duration: z.enum(['once', 'repeating', 'forever']).default('once'),
    durationInMonths: z.number().int().positive().optional(),
    /** Apply to the customer's subscription or hand out a promotion code in the reply. */
    applyTo: z.enum(['subscription', 'promotion_code']).default('subscription'),
    stripeCustomerId: z.string().min(1).optional(),
    stripeSubscriptionId: z.string().min(1).optional(),
    name: z.string().max(80).optional(),
  }),
  create_linear_ticket: z.object({
    title: z.string().min(3).max(200),
    description: z.string().min(1),
    label: z.enum(['Bug', 'Feature']),
    /** When the agent found an existing issue, link it (comment) instead of creating a duplicate. */
    existingIssueIdentifier: z
      .string()
      .regex(/^[A-Z]+-\d+$/)
      .optional(),
    customerEmail: email,
  }),
  store_release_notification_email: z.object({
    linearIssueIdentifier: z
      .string()
      .regex(/^[A-Z]+-\d+$/)
      .optional(),
    /** Set when the issue is created by `create_linear_ticket` in the same proposal. */
    fromActionPosition: z.number().int().nonnegative().optional(),
    email,
  }),
  store_cancellation_reason: z.object({
    stripeCustomerId: z.string().min(1).optional(),
    stripeSubscriptionId: z.string().min(1).optional(),
    feedback: z.enum(STRIPE_CANCELLATION_FEEDBACK).default('other'),
    /** Verbatim reason, or "Not stated". */
    comment: z.string().min(1).max(500),
  }),
  remove_from_tracking: z.object({
    instagramHandle: z
      .string()
      .min(1)
      .transform((s) => s.replace(/^@/, '').toLowerCase()),
    reason: z.string().min(1).max(500),
  }),
  send_reply: z.object({
    to: email,
    cc: z.array(email).default([]),
    /** Attachments come from the reply draft; this only tells the executor whether to include them. */
    includeAttachments: z.boolean().default(true),
  }),
} as const satisfies Record<ActionType, z.ZodType>

export type ActionParams<T extends ActionType = ActionType> = z.infer<
  (typeof ACTION_PARAM_SCHEMAS)[T]
>
export type ActionParamsInput<T extends ActionType = ActionType> = z.input<
  (typeof ACTION_PARAM_SCHEMAS)[T]
>

export interface ActionDefinition<T extends ActionType = ActionType> {
  key: T
  /** Exact name as in the Notion Templates DB. */
  label: string
  /** One-line description for the "Add action" picker. */
  description: string
  /** Which system the action writes to. */
  target: 'stripe' | 'instaradar' | 'linear' | 'maelle' | 'mail'
  paramsSchema: (typeof ACTION_PARAM_SCHEMAS)[T]
  /** Cannot be undone. Needs `confirmIrreversible`, locked by default for Auto. */
  irreversible: boolean
  /** Can be locked for Auto mode on the Autonomy page. */
  lockable: boolean
  /** Locked for Auto until the user unlocks it. */
  lockedByDefault: boolean
  /** Sort order. Send reply is always last. */
  order: number
}

function def<T extends ActionType>(d: ActionDefinition<T>): ActionDefinition<T> {
  return d
}

export const ACTIONS = {
  cancel_at_period_end: def({
    key: 'cancel_at_period_end',
    label: 'Cancel at period end',
    description: 'Stops renewals; the customer keeps access until the paid period ends.',
    target: 'stripe',
    paramsSchema: ACTION_PARAM_SCHEMAS.cancel_at_period_end,
    irreversible: false,
    lockable: true,
    lockedByDefault: false,
    order: 10,
  }),
  cancel_immediately: def({
    key: 'cancel_immediately',
    label: 'Cancel immediately',
    description:
      'Ends the subscription now. InstaRadar deletes the tracked profiles on cancellation.',
    target: 'stripe',
    paramsSchema: ACTION_PARAM_SCHEMAS.cancel_immediately,
    irreversible: true,
    lockable: true,
    lockedByDefault: true,
    // After the refund: if the refund fails, the customer keeps access.
    order: 35,
  }),
  refund_latest_payment: def({
    key: 'refund_latest_payment',
    label: 'Refund latest payment',
    description: 'Refunds the latest successful payment, full amount by default.',
    target: 'stripe',
    paramsSchema: ACTION_PARAM_SCHEMAS.refund_latest_payment,
    irreversible: true,
    lockable: true,
    lockedByDefault: true,
    order: 30,
  }),
  delete_account: def({
    key: 'delete_account',
    label: 'Delete account',
    description:
      'Deletes the InstaRadar account and all its data. Only after cancellation and explicit confirmation.',
    target: 'instaradar',
    paramsSchema: ACTION_PARAM_SCHEMAS.delete_account,
    irreversible: true,
    lockable: true,
    lockedByDefault: true,
    order: 40,
  }),
  stop_failed_payment_retries: def({
    key: 'stop_failed_payment_retries',
    label: 'Stop failed-payment retries',
    description:
      'Stops collection of open invoices so Smart Retries end, without deleting records.',
    target: 'stripe',
    paramsSchema: ACTION_PARAM_SCHEMAS.stop_failed_payment_retries,
    irreversible: false,
    lockable: true,
    lockedByDefault: false,
    // Before a refund: no new charge can slip in while the refund runs.
    order: 25,
  }),
  create_coupon: def({
    key: 'create_coupon',
    label: 'Create coupon',
    description:
      'Percent or amount off, applied to the subscription or handed out as a promotion code.',
    target: 'stripe',
    paramsSchema: ACTION_PARAM_SCHEMAS.create_coupon,
    irreversible: false,
    lockable: true,
    lockedByDefault: false,
    order: 60,
  }),
  create_linear_ticket: def({
    key: 'create_linear_ticket',
    label: 'Create Linear ticket',
    description: 'Creates a Bug or Feature issue in team InstaRadar, or links an existing one.',
    target: 'linear',
    paramsSchema: ACTION_PARAM_SCHEMAS.create_linear_ticket,
    irreversible: false,
    lockable: true,
    lockedByDefault: false,
    order: 70,
  }),
  store_release_notification_email: def({
    key: 'store_release_notification_email',
    label: 'Store email for release notification',
    description: 'Remembers the customer so they hear from us when the issue ships.',
    target: 'maelle',
    paramsSchema: ACTION_PARAM_SCHEMAS.store_release_notification_email,
    irreversible: false,
    lockable: true,
    lockedByDefault: false,
    order: 80,
  }),
  store_cancellation_reason: def({
    key: 'store_cancellation_reason',
    label: 'Store cancellation reason',
    description: 'Logs why the customer left, in Maelle and on the Stripe subscription.',
    target: 'maelle',
    paramsSchema: ACTION_PARAM_SCHEMAS.store_cancellation_reason,
    irreversible: false,
    lockable: true,
    lockedByDefault: false,
    order: 90,
  }),
  remove_from_tracking: def({
    key: 'remove_from_tracking',
    label: 'Remove from tracking & viewing',
    description: 'Blocks the Instagram profile from being tracked or viewed on InstaRadar.',
    target: 'instaradar',
    paramsSchema: ACTION_PARAM_SCHEMAS.remove_from_tracking,
    irreversible: false,
    lockable: true,
    lockedByDefault: false,
    order: 100,
  }),
  send_reply: def({
    key: 'send_reply',
    label: 'Send reply',
    description: 'Sends the reply draft from support@instaradar.app into the customer thread.',
    target: 'mail',
    paramsSchema: ACTION_PARAM_SCHEMAS.send_reply,
    irreversible: false,
    lockable: false,
    lockedByDefault: false,
    order: 1000,
  }),
} as const satisfies { [K in ActionType]: ActionDefinition<K> }

export const ACTION_LIST: readonly ActionDefinition[] = ACTION_TYPES.map((k) => ACTIONS[k])

export const IRREVERSIBLE_ACTION_TYPES: readonly ActionType[] = ACTION_LIST.filter(
  (a) => a.irreversible,
).map((a) => a.key)

export function isActionType(value: unknown): value is ActionType {
  return typeof value === 'string' && (ACTION_TYPES as readonly string[]).includes(value)
}

export function getAction<T extends ActionType>(type: T): ActionDefinition<T> {
  return ACTIONS[type] as unknown as ActionDefinition<T>
}

export function actionLabel(type: ActionType): string {
  return ACTIONS[type].label
}

export function isIrreversible(type: ActionType): boolean {
  return ACTIONS[type].irreversible
}

/** Validate params for an action. Throws a ZodError on failure. */
export function parseActionParams<T extends ActionType>(type: T, params: unknown): ActionParams<T> {
  return ACTION_PARAM_SCHEMAS[type].parse(params) as ActionParams<T>
}

export function safeParseActionParams<T extends ActionType>(type: T, params: unknown) {
  return ACTION_PARAM_SCHEMAS[type].safeParse(params)
}

/** Sort anything that carries an action type into registry order; Send reply always last. */
export function sortByActionOrder<T extends { type: ActionType }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => ACTIONS[a.type].order - ACTIONS[b.type].order)
}

export const ACTION_TOTAL = ACTION_TYPES.length
