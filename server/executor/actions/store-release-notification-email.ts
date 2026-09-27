import { PreconditionError } from '../errors'
import type { ActionHandler } from '../types'

interface LinearResult {
  identifier?: string
  id?: string
}

/** Remembers the customer for the created or linked issue (release_notifications). */
export const storeReleaseNotificationEmail: ActionHandler<'store_release_notification_email'> = {
  type: 'store_release_notification_email',
  consequence: 'the email was not stored',
  async run(params, ctx) {
    let identifier = params.linearIssueIdentifier ?? null
    let issueId: string | null = null
    if (!identifier && params.fromActionPosition != null) {
      const prior = ctx.priorResults.get(params.fromActionPosition) as LinearResult | undefined
      if (!prior?.identifier) {
        throw new PreconditionError(
          `Waiting on Create Linear ticket (action ${params.fromActionPosition + 1}), which has not succeeded`,
        )
      }
      identifier = prior.identifier
      issueId = prior.id ?? null
    }
    if (!identifier) {
      for (const r of ctx.priorResults.values()) {
        const lr = r as LinearResult | undefined
        if (lr?.identifier) {
          identifier = lr.identifier
          issueId = lr.id ?? null
          break
        }
      }
    }
    if (!identifier) throw new PreconditionError('No Linear issue to attach the email to')
    const { inserted } = await ctx.store.insertReleaseNotification({
      appId: ctx.ticket.appId,
      linearIssueId: issueId,
      linearIssueIdentifier: identifier,
      email: params.email,
      ticketId: ctx.ticket.id,
    })
    return {
      result: { identifier, email: params.email, alreadyStored: !inserted },
      externalRefs: { linearIssue: identifier },
    }
  },
}
