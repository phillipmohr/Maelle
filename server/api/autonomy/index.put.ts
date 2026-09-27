/**
 * PUT /api/autonomy — owner: IRDR-459. Modes, locks and settings (partial). Every change writes a
 * settings_audit row (who, what, from, to). 503 without a database.
 */
import type { AutonomyResponse } from '#shared/api'
import { AutonomyUpdateSchema } from '#shared/autonomy'
import { isDbConfigured } from '../../utils/db'
import { currentAppId } from '../../autonomy/app'
import { applyAutonomyUpdate, buildAutonomyResponse } from '../../autonomy/repo'

export default defineEventHandler(async (event): Promise<AutonomyResponse> => {
  const body = await readBody(event).catch(() => null)
  const parsed = AutonomyUpdateSchema.safeParse(body)
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid autonomy update',
      data: { issues: parsed.error.issues },
    })
  }
  if (!isDbConfigured()) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'Database is not configured (SUPABASE_DB_URL). Autonomy settings can only be changed with a database.',
    })
  }
  const appId = await currentAppId()
  const changedBy = event.context.session?.email ?? 'unknown'
  const changes = await applyAutonomyUpdate(appId, parsed.data, changedBy)
  const response = await buildAutonomyResponse(appId)
  return { ...response, changes }
})
