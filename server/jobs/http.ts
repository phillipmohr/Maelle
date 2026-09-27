/**
 * Cron route handlers (IRDR-455). Vercel Cron invokes paths with GET, the binding route table lists
 * POST, so both methods map here. CRON_SECRET is checked by the auth middleware for /api/cron/*.
 */
import { isDbConfigured } from '../utils/db'
import { runFetchMailLane, runTick } from './tick'

function requireDb() {
  if (!isDbConfigured()) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Database is not configured (SUPABASE_DB_URL); the job runner needs it.',
    })
  }
}

export const tickHandler = defineEventHandler(async () => {
  requireDb()
  return runTick()
})

export const fetchMailHandler = defineEventHandler(async () => {
  requireDb()
  return runFetchMailLane()
})
