/** POST /api/tickets/:id/mark-done — owner: IRDR-457. Stub: note required. */
import type { MarkDoneRequest } from '#shared/api'
import { stubHeaders } from '../../../utils/stubs'

export default defineEventHandler(async (event) => {
  stubHeaders(event, 'IRDR-457')
  const body = await readBody<MarkDoneRequest>(event)
  if (!body?.note?.trim())
    throw createError({ statusCode: 400, statusMessage: 'A note is required' })
  return { ok: true as const, ticketStatus: 'closed', resolution: 'marked_done' }
})
