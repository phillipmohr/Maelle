import { PreconditionError } from '../errors'
import type { ActionHandler } from '../types'

/**
 * Deletes the InstaRadar account (irreversible): only without an active subscription and with the
 * customer's explicit confirmation. Rows go through the InstaRadar DB role in one transaction, then
 * the auth user through the InstaRadar project's Auth admin API. A retry finishes what a failed
 * attempt left behind.
 */
export const deleteAccount: ActionHandler<'delete_account'> = {
  type: 'delete_account',
  consequence: 'nothing was deleted',
  async run(params, ctx) {
    if (!ctx.customerConfirmed) {
      throw new PreconditionError(
        "Delete account needs the customer's explicit confirmation in the thread",
      )
    }
    const { stripe, instaradar, authAdmin } = ctx.clients
    const userId = params.instaradarUserId

    let subscriptionCheck = 'skipped: no Stripe customer on the ticket'
    const customer = ctx.ticket.stripeCustomerId
    if (customer) {
      const subs = await stripe.listSubscriptions(customer)
      const active = subs.filter(
        (s) => s.status !== 'canceled' && s.status !== 'incomplete_expired',
      )
      if (active.length > 0) {
        throw new PreconditionError(
          `The customer still has an active subscription (${active.map((s) => s.id).join(', ')}), cancel it first`,
        )
      }
      subscriptionCheck = `${subs.length} subscription${subs.length === 1 ? '' : 's'} checked, none active`
    }

    const [inDb, authUser] = await Promise.all([
      instaradar.userExists(userId),
      authAdmin.getUser(userId),
    ])
    if (!inDb && !authUser) {
      if (ctx.attempt > 1) {
        return {
          result: { userId, email: params.email, alreadyDeleted: true, subscriptionCheck },
        }
      }
      throw new PreconditionError(`No InstaRadar account found for user ${userId}`)
    }
    if (authUser?.email && authUser.email.toLowerCase() !== params.email.toLowerCase()) {
      throw new PreconditionError(
        `Account ${userId} belongs to ${authUser.email}, not to ${params.email}`,
      )
    }

    const data = await instaradar.deleteUserData(userId)
    if (authUser) await authAdmin.deleteUser(userId)
    return {
      result: {
        userId,
        email: params.email,
        deletedRows: data.deleted,
        authUserDeleted: Boolean(authUser),
        subscriptionCheck,
      },
    }
  },
}
