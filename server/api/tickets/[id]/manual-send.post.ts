/** POST /api/tickets/:id/manual-send — owner: IRDR-457. Stub. */
import type { ApproveResponse, ManualSendRequest } from '#shared/api'
import { isActionType } from '#shared/actions'
import { stubHeaders } from '../../../utils/stubs'

export default defineEventHandler(async (event): Promise<ApproveResponse> => {
  stubHeaders(event, 'IRDR-457')
  const body = await readBody<ManualSendRequest>(event)
  if (!body?.reply?.body?.trim() || !body.reply.to)
    throw createError({ statusCode: 400, statusMessage: 'reply.to and reply.body are required' })
  for (const a of body.actions ?? []) {
    if (!isActionType(a.type))
      throw createError({ statusCode: 400, statusMessage: `Unknown action ${String(a.type)}` })
  }
  return {
    decisionId: `stub-manual-${getRouterParam(event, 'id')}`,
    ticketStatus: 'closed',
    executions: [
      ...(body.actions ?? []).map((a, i) => ({
        executionId: `stub-exec-${i}`,
        type: a.type,
        status: 'succeeded' as const,
        result: { stub: true },
      })),
      {
        executionId: 'stub-exec-reply',
        type: 'send_reply' as const,
        status: 'succeeded' as const,
        result: { stub: true },
      },
    ],
  }
})
