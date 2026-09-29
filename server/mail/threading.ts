/**
 * Threading (IRDR-455): In-Reply-To / References first, then the provider thread id (Gmail),
 * then the same sender with the same normalised subject within 30 days.
 */
import type { Db } from '../jobs/db'
import type { ParsedMail } from './parse'

const PREFIX = /^\s*((re|aw|wg|fw|fwd|sv|vs|tr|rif|r|antw|ref)\s*(\[\d+\]|\(\d+\))?\s*:\s*)+/i
const TAGS = /^\s*(\[[^\]]{1,40}\]\s*)+/

/** Strips Re:/Fwd:/AW:/WG: prefixes (repeated), bracketed tags, whitespace and case. */
export function normalizeSubject(subject: string | null | undefined): string {
  let s = (subject ?? '').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 5; i++) {
    const before = s
    s = s.replace(PREFIX, '').replace(TAGS, '').trim()
    if (s === before) break
  }
  return s.toLowerCase()
}

export const THREAD_FALLBACK_DAYS = 30

export interface ThreadMatch {
  ticketId: string
  via: 'headers' | 'provider_thread' | 'subject'
}

export async function findThreadTicket(
  db: Db,
  mail: ParsedMail,
  opts: {
    appId: string
    /** Reference time of the 30-day subject window: today for live mail, the mail's own date for history. */
    now: Date
    providerThreadId?: string | null
    /**
     * History import: the subject fallback also ignores tickets that started more than 30 days after
     * the mail (a March mail must not join a September ticket that happens to share the subject).
     */
    bounded?: boolean
  },
): Promise<ThreadMatch | null> {
  const ids = [mail.inReplyTo, ...mail.references].filter((x): x is string => Boolean(x))
  if (ids.length) {
    const row = await db.one<{ ticket_id: string }>(
      `select m.ticket_id from public.messages m
       join public.tickets t on t.id = m.ticket_id
       where t.app_id = $2 and m.message_id = any ($1::text[])
       order by m.created_at desc limit 1`,
      [ids, opts.appId],
    )
    if (row) return { ticketId: row.ticket_id, via: 'headers' }
  }
  if (opts.providerThreadId) {
    const row = await db.one<{ ticket_id: string }>(
      `select m.ticket_id from public.messages m
       join public.tickets t on t.id = m.ticket_id
       where t.app_id = $2 and m.provider_thread_id = $1
       order by m.created_at desc limit 1`,
      [opts.providerThreadId, opts.appId],
    )
    if (row) return { ticketId: row.ticket_id, via: 'provider_thread' }
  }
  const norm = normalizeSubject(mail.subject)
  if (mail.from && norm) {
    const windowMs = THREAD_FALLBACK_DAYS * 24 * 60 * 60 * 1000
    const since = new Date(opts.now.getTime() - windowMs)
    const until = opts.bounded ? new Date(opts.now.getTime() + windowMs) : null
    const candidates = await db.query<{ id: string; subject: string | null }>(
      `select id, subject from public.tickets
       where app_id = $1 and lower(customer_email) = $2
         and coalesce(last_message_at, created_at) >= $3
         and ($4::timestamptz is null or coalesce(first_message_at, created_at) <= $4::timestamptz)
       order by coalesce(last_message_at, created_at) desc
       limit 25`,
      [opts.appId, mail.from.address.toLowerCase(), since, until],
    )
    const hit = candidates.find((c) => normalizeSubject(c.subject) === norm)
    if (hit) return { ticketId: hit.id, via: 'subject' }
  }
  return null
}
