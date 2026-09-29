/** Shared by the /api/mail routes (IRDR-455): the mail context, or 503 without a database. */
import { getMailContext, type MailContext } from '../../mail/context'
import { isDbConfigured } from '../../utils/db'

export function requireMailContext(): MailContext {
  if (!isDbConfigured()) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Database is not configured (SUPABASE_DB_URL); the mailbox needs it.',
    })
  }
  return getMailContext()
}
