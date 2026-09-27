import { EM_DASH_RE } from '#shared/proposal'
import { PreconditionError, ProviderError } from '../errors'
import type { ActionHandler } from '../types'

/**
 * Sends the reply through mail.sendReply with the execution's idempotency key (exactly once per
 * ticket and draft). Holding the reply while a required action failed, and scheduling it for Auto,
 * is decided by the engine before this handler runs.
 */
export const sendReply: ActionHandler<'send_reply'> = {
  type: 'send_reply',
  consequence: 'the reply was not sent',
  async run(params, ctx) {
    const draft = ctx.replyDraft
    if (!draft) throw new PreconditionError('There is no reply draft to send')
    if (EM_DASH_RE.test(draft.body) || EM_DASH_RE.test(draft.subject)) {
      throw new PreconditionError('The reply contains an em dash')
    }
    const final = {
      ...draft,
      to: params.to,
      attachments: params.includeAttachments ? draft.attachments : [],
    }
    try {
      const sent = await ctx.mail.sendReply(ctx.ticket.id, final, {
        sentBy: ctx.executedBy,
        idempotencyKey: ctx.idempotencyKey,
      })
      return {
        result: {
          to: params.to,
          cc: params.cc,
          subject: final.subject,
          messageId: sent.messageId,
          providerMessageId: sent.providerMessageId,
          rfcMessageId: sent.rfcMessageId,
          attachments: final.attachments.length,
        },
        externalRefs: { messageId: sent.messageId, providerMessageId: sent.providerMessageId },
      }
    } catch (err) {
      if (err instanceof ProviderError || err instanceof PreconditionError) throw err
      throw new ProviderError('Mail', err instanceof Error ? err.message : String(err), {
        retryable: true,
        cause: err,
      })
    }
  },
}
