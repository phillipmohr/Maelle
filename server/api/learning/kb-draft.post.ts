/**
 * POST /api/learning/kb-draft — owner: IRDR-459. Claude condenses the final reply into a Knowledge
 * Base entry and creates it as a Draft page (App InstaRadar, Related templates). Idempotent per ticket.
 */
import type { LearningKbDraftRequest, LearningResponse } from '#shared/api'
import { isDbConfigured } from '../../utils/db'
import { LearningError, createKbDraft, defaultLearningDeps } from '../../learning'

export default defineEventHandler(async (event): Promise<LearningResponse> => {
  const body = await readBody<Partial<LearningKbDraftRequest>>(event).catch(() => null)
  const ticketId = typeof body?.ticketId === 'string' ? body.ticketId.trim() : ''
  if (!ticketId) throw createError({ statusCode: 400, statusMessage: 'ticketId is required' })
  if (!isDbConfigured()) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'Database is not configured (SUPABASE_DB_URL). Create KB draft needs the ticket from the database.',
    })
  }
  try {
    return await createKbDraft(
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
