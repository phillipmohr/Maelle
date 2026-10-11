/**
 * GET /api/tickets/approve-all — owner: IRDR-481. What "Approve & send all" would send: the unsent
 * drafts that pass the bulk guards (server/executor/approve-all.ts), and the skipped ones with the
 * reason. Reads only. 503 without a database.
 */
import type { ApproveAllPreviewResponse } from '#shared/api'
import { findRegenerableDrafts } from '../../agent/regenerate'
import { loadEvaluateContextFromDb } from '../../autonomy/context'
import { previewApproveAll } from '../../executor/approve-all'
import { isDbConfigured } from '../../utils/db'

export default defineEventHandler(async (): Promise<ApproveAllPreviewResponse> => {
  if (!isDbConfigured()) {
    throw createError({
      statusCode: 503,
      statusMessage:
        'Database is not configured (SUPABASE_DB_URL). Replies can only be sent with a database.',
    })
  }
  return previewApproveAll({
    candidates: findRegenerableDrafts,
    loadContext: loadEvaluateContextFromDb,
  })
})
