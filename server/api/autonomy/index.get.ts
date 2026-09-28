/**
 * GET /api/autonomy — owner: IRDR-459. Track record per case type from the decisions table,
 * settings, modes and locks. Answers from the seed when no database is configured.
 */
import type { AutonomyResponse } from '#shared/api'
import { isDbConfigured } from '../../utils/db'
import { seedBundle, stubHeaders } from '../../utils/stubs'
import { currentAppId } from '../../autonomy/app'
import { buildAutonomyResponse } from '../../autonomy/repo'
import { seedAutonomyResponse } from '../../autonomy/seed'

export default defineEventHandler(async (event): Promise<AutonomyResponse> => {
  if (!isDbConfigured()) {
    stubHeaders(event, 'IRDR-459')
    return seedAutonomyResponse(seedBundle())
  }
  return buildAutonomyResponse(await currentAppId())
})
