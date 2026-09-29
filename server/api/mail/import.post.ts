/**
 * POST /api/mail/import — owner: IRDR-455. "Import history": queues the first chunk of the
 * mailbox history import (see server/mail/backfill.ts); the cron lanes run it to completion.
 */
import type { MailImportResponse } from '#shared/api'
import { startBackfill } from '../../mail/backfill'
import { mailStatus } from '../../mail/status'
import { requireMailContext } from './_context'

export default defineEventHandler(async (): Promise<MailImportResponse> => {
  const ctx = requireMailContext()
  const { started } = await startBackfill(ctx)
  return { ok: true, started, status: await mailStatus(ctx) }
})
