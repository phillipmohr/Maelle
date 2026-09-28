/**
 * GET /api/activity — owner: IRDR-459. Every executed action (action_executions joined with
 * tickets), filters by / irreversibleOnly / from / to, cursor pagination, plus the settings changes
 * of the same time range. Answers from the seed when no database is configured.
 */
import type { ActivityResponse } from '#shared/api'
import { isDbConfigured } from '../../utils/db'
import { seedBundle, stubHeaders } from '../../utils/stubs'
import { currentAppId } from '../../autonomy/app'
import { parseActivityQuery, queryActivity, seedActivityResponse } from '../../autonomy/activity'

export default defineEventHandler(async (event): Promise<ActivityResponse> => {
  const filters = parseActivityQuery(getQuery(event) as Record<string, unknown>)
  if (!isDbConfigured()) {
    stubHeaders(event, 'IRDR-459')
    return seedActivityResponse(seedBundle(), filters)
  }
  return queryActivity(await currentAppId(), filters)
})
