/**
 * The 11 action handlers, keyed by registry type. The engine looks a handler up, validates the
 * params with the shared schema, runs it with an idempotency key and writes the audit row.
 */
import { ACTIONS, type ActionType } from '#shared/actions'
import type { ActionHandler } from '../types'
import { cancelAtPeriodEnd } from './cancel-at-period-end'
import { cancelImmediately } from './cancel-immediately'
import { createCoupon } from './create-coupon'
import { createLinearTicket } from './create-linear-ticket'
import { deleteAccount } from './delete-account'
import { refundLatestPayment } from './refund-latest-payment'
import { removeFromTracking } from './remove-from-tracking'
import { sendReply } from './send-reply'
import { stopFailedPaymentRetries } from './stop-failed-payment-retries'
import { storeCancellationReason } from './store-cancellation-reason'
import { storeReleaseNotificationEmail } from './store-release-notification-email'
import { formatMoney } from '../format'

export const ACTION_HANDLERS: { [K in ActionType]: ActionHandler<K> } = {
  cancel_at_period_end: cancelAtPeriodEnd,
  cancel_immediately: cancelImmediately,
  refund_latest_payment: refundLatestPayment,
  delete_account: deleteAccount,
  stop_failed_payment_retries: stopFailedPaymentRetries,
  create_coupon: createCoupon,
  create_linear_ticket: createLinearTicket,
  store_release_notification_email: storeReleaseNotificationEmail,
  store_cancellation_reason: storeCancellationReason,
  remove_from_tracking: removeFromTracking,
  send_reply: sendReply,
}

export function getHandler(type: ActionType): ActionHandler {
  return ACTION_HANDLERS[type] as unknown as ActionHandler
}

/** One line for the confirm bar: what the irreversible action will do. */
export function describeEffect(type: ActionType, params: Record<string, unknown>): string {
  switch (type) {
    case 'refund_latest_payment': {
      const amount = typeof params.amountCents === 'number' ? params.amountCents : null
      const currency = typeof params.currency === 'string' ? params.currency : 'usd'
      const card = typeof params.cardLabel === 'string' ? ` to ${params.cardLabel}` : ''
      return amount != null
        ? `Refund ${formatMoney(amount, currency)}${card}`
        : 'Refund the latest payment'
    }
    case 'cancel_immediately': {
      const n = typeof params.profilesAffected === 'number' ? params.profilesAffected : null
      return n != null
        ? `Cancel immediately and delete ${n} tracked profile${n === 1 ? '' : 's'}`
        : 'Cancel the subscription immediately'
    }
    case 'delete_account': {
      const email = typeof params.email === 'string' ? ` of ${params.email}` : ''
      return `Delete the InstaRadar account${email} and all its data`
    }
    default:
      return ACTIONS[type].description
  }
}
