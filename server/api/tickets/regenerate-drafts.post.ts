/**
 * POST /api/tickets/regenerate-drafts — owner: IRDR-456. Regenerates every unsent reply draft
 * (tickets in needs_decision with a reply on the active proposal), e.g. after the templates, the
 * protocol or the settings changed: one `agent_run` job with trigger `rerun` per ticket, the same as
 * the per-ticket regenerate. While the jobs service is still the foundation stub, the runs start
 * inline one after the other in the background. 503 without a database.
 */
import type { RegenerateDraftsResponse } from '#shared/api'
import { findRegenerableDrafts } from '../../agent/regenerate'
import { isDbConfigured } from '../../utils/db'
import { isServiceRegistered, services } from '../../utils/services'

export default defineEventHandler(async (): Promise<RegenerateDraftsResponse> => {
  if (!isDbConfigured()) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'Database is not configured (SUPABASE_DB_URL). Drafts can only be regenerated with a database.',
    })
  }
  const ticketIds = await findRegenerableDrafts()
  for (const ticketId of ticketIds)
    await services.jobs.enqueue('agent_run', { ticketId, trigger: 'rerun' })
  const inline = !isServiceRegistered('jobs')
  if (inline && ticketIds.length > 0) {
    void (async () => {
      for (const ticketId of ticketIds)
        await services.agent
          .run(ticketId, 'rerun')
          .catch((e: unknown) => console.error('[agent] inline regenerate failed', ticketId, e))
    })()
  }
  return { count: ticketIds.length, ticketIds, inline }
})
