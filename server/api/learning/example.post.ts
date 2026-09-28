/**
 * POST /api/learning/example — owner: IRDR-459. Creates a Draft page in the Notion Examples DB
 * from the ticket's customer message and its final reply. Idempotent per ticket.
 */
import type { LearningExampleRequest, LearningResponse } from '#shared/api'
import { isDbConfigured } from '../../utils/db'
import { LearningError, defaultLearningDeps, saveExample } from '../../learning'

export default defineEventHandler(async (event): Promise<LearningResponse> => {
  const body = await readBody<Partial<LearningExampleRequest>>(event).catch(() => null)
  const ticketId = typeof body?.ticketId === 'string' ? body.ticketId.trim() : ''
  if (!ticketId) throw createError({ statusCode: 400, statusMessage: 'ticketId is required' })
  if (!isDbConfigured()) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'Database is not configured (SUPABASE_DB_URL). Save as example needs the ticket from the database.',
    })
  }
  try {
    return await saveExample(
      defaultLearningDeps(),
      ticketId,
      event.context.session?.email ?? 'unknown',
    )
  } catch (e) {
    if (e instanceof LearningError)
      throw createError({ statusCode: e.statusCode, statusMessage: e.message })
    throw e
  }
})
