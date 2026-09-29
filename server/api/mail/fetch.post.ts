/**
 * POST /api/mail/fetch — owner: IRDR-455. "Fetch now": runs the live fetch once, in the request,
 * and answers with its summary. Safe next to the cron's own run (every message deduplicates).
 */
import type { MailFetchResponse } from '#shared/api'
import { fetchMail } from '../../mail/inbound'
import { requireMailContext } from './_context'

export default defineEventHandler(async (): Promise<MailFetchResponse> => {
  const r = await fetchMail(requireMailContext())
  return {
    ok: true,
    fetched: r.fetched,
    ingested: r.ingested,
    skipped: r.skipped,
    ignored: r.ignored,
    failed: r.failed,
    ticketsCreated: r.ticketsCreated,
  }
})
