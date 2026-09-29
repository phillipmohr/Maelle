/**
 * GET /api/usage?days=30 — owner: IRDR-460. Claude token usage and cost of the last `days` days:
 * totals, per day, per purpose, per model, per tool and the most expensive tickets. Answers from
 * the seed when no database is configured.
 */
import type { UsageResponse } from '#shared/api'
import { seedUsageResponse } from '#shared/seed/views'
import { usageWindow } from '#shared/usage'
import { dbQuery, isDbConfigured } from '../../utils/db'
import { seedBundle, stubHeaders } from '../../utils/stubs'
import { usageFromDb } from '../../usage/query'

export default defineEventHandler(async (event): Promise<UsageResponse> => {
  const window = usageWindow((getQuery(event) as Record<string, unknown>).days)
  if (!isDbConfigured()) {
    stubHeaders(event, 'IRDR-460')
    return seedUsageResponse(seedBundle(), window)
  }
  return usageFromDb((text, params) => dbQuery(text, params ?? []), window)
})
