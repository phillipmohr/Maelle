import { PreconditionError } from '../errors'
import type { ActionHandler } from '../types'

export function linearMarker(displayNumber: number): string {
  return `Maelle ticket #${displayNumber}`
}

export function notifyLine(email: string): string {
  return `Customer to notify once released: ${email}`
}

/**
 * Creates a Bug or Feature issue in team InstaRadar, or, when the agent found an existing issue,
 * links it with a comment. Every issue and comment carries the marker "Maelle ticket #<n>", which
 * is checked before writing, so a retry never creates a duplicate.
 */
export const createLinearTicket: ActionHandler<'create_linear_ticket'> = {
  type: 'create_linear_ticket',
  consequence: 'the Linear issue was not created',
  async run(params, ctx) {
    const { linear } = ctx.clients
    const marker = linearMarker(ctx.ticket.displayNumber)
    const notify = notifyLine(params.customerEmail)

    if (params.existingIssueIdentifier) {
      const issue = await linear.getIssue(params.existingIssueIdentifier)
      if (!issue) {
        throw new PreconditionError(`Linear issue ${params.existingIssueIdentifier} was not found`)
      }
      const comments = await linear.listComments(issue.id)
      const existing = comments.find((c) => c.body.includes(marker))
      const refs = { linearIssue: issue.identifier, linearIssueId: issue.id }
      if (existing) {
        return {
          result: {
            linked: true,
            identifier: issue.identifier,
            id: issue.id,
            url: issue.url,
            commentId: existing.id,
            alreadyLinked: true,
          },
          externalRefs: { ...refs, linearCommentId: existing.id },
        }
      }
      const body = [notify, '', params.description.trim(), '', marker].join('\n')
      const comment = await linear.createComment(issue.id, body)
      return {
        result: {
          linked: true,
          identifier: issue.identifier,
          id: issue.id,
          url: issue.url,
          commentId: comment.id,
        },
        externalRefs: { ...refs, linearCommentId: comment.id },
      }
    }

    const found = await linear.findIssueByMarker(marker)
    if (found) {
      return {
        result: {
          created: true,
          identifier: found.identifier,
          id: found.id,
          url: found.url,
          alreadyCreated: true,
        },
        externalRefs: { linearIssue: found.identifier, linearIssueId: found.id },
      }
    }
    const parts = [params.description.trim()]
    if (!params.description.includes(notify)) parts.push('', notify)
    parts.push('', marker)
    const issue = await linear.createIssue({
      title: params.title,
      description: parts.join('\n'),
      label: params.label,
    })
    return {
      result: {
        created: true,
        identifier: issue.identifier,
        id: issue.id,
        url: issue.url,
        label: params.label,
      },
      externalRefs: { linearIssue: issue.identifier, linearIssueId: issue.id },
    }
  },
}
