/**
 * POST /api/mail/classify-imported — owner: IRDR-455. Queues the classify-only pass over imported
 * tickets that have no case yet (it also starts by itself when an import finishes).
 */
import type { MailClassifyImportedResponse } from '#shared/api'
import { scheduleImportedClassification } from '../../mail/history-classify'
import { mailStatus } from '../../mail/status'
import { requireMailContext } from './_context'

export default defineEventHandler(async (): Promise<MailClassifyImportedResponse> => {
  const ctx = requireMailContext()
  const { started, reason } = await scheduleImportedClassification(ctx)
  return { ok: true, started, reason, status: await mailStatus(ctx) }
})
