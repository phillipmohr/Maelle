/**
 * POST /api/webhooks/linear — owner: IRDR-455. Verifies Linear-Signature (HMAC-SHA256 of the raw
 * body with LINEAR_WEBHOOK_SECRET), then creates one release_notification ticket per stored customer
 * email when an InstaRadar issue is completed. Linear retries non-200 responses; the handler is idempotent.
 */
import { LINEAR } from '#shared/config'
import { poolDb } from '../../jobs/db'
import {
  LINEAR_SIGNATURE_HEADER,
  processLinearWebhook,
  WebhookError,
} from '../../mail/linear-webhook'
import { isDbConfigured } from '../../utils/db'

export default defineEventHandler(async (event) => {
  if (!isDbConfigured()) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Database is not configured (SUPABASE_DB_URL).',
    })
  }
  const config = useRuntimeConfig(event)
  const rawBody = (await readRawBody(event, 'utf8')) ?? ''
  try {
    return await processLinearWebhook({
      rawBody,
      signature: getHeader(event, LINEAR_SIGNATURE_HEADER),
      secret: config.linearWebhookSecret || process.env.LINEAR_WEBHOOK_SECRET || null,
      db: poolDb(),
      teamId: LINEAR.teamId,
      teamKey: LINEAR.teamKey,
    })
  } catch (e) {
    if (e instanceof WebhookError) {
      throw createError({ statusCode: e.status, statusMessage: e.message })
    }
    throw e
  }
})
