/**
 * The notifications log: what went out, and the dedupe that keeps the high-risk alert to one per
 * ticket and the digest to one per day. Database-backed in production, in memory offline and in tests.
 */
import type { NotifyKind } from '#shared/services'
import { dbOne, dbQuery } from '../utils/db'

export interface NotificationClaimInput {
  kind: NotifyKind
  /** Null: always send (system alerts). */
  dedupeKey: string | null
  ticketId?: string | null
  meta?: Record<string, unknown>
}

export interface NotificationResult {
  status: 'sent' | 'failed' | 'skipped'
  recipient: string | null
  subject: string
  body: string
  error?: string | null
}

export interface NotificationLog {
  /** A claim to send, or null when the same kind + key was already sent (or is being sent right now). */
  claim(input: NotificationClaimInput): Promise<{ id: string } | null>
  finish(id: string, result: NotificationResult): Promise<void>
  /** When the last notification of this kind went out. */
  lastSentAt(kind: NotifyKind): Promise<string | null>
}

export interface MemoryNotification extends NotificationClaimInput {
  id: string
  status: 'pending' | 'sent' | 'failed' | 'skipped'
  recipient: string | null
  subject: string
  body: string
  error: string | null
  sentAt: string | null
}

export function createMemoryNotificationLog(
  now: () => Date = () => new Date(),
): NotificationLog & { entries: MemoryNotification[] } {
  const entries: MemoryNotification[] = []
  let seq = 0
  return {
    entries,
    async claim(input) {
      if (input.dedupeKey) {
        const existing = entries.find(
          (e) => e.kind === input.kind && e.dedupeKey === input.dedupeKey,
        )
        if (existing) {
          if (existing.status === 'sent' || existing.status === 'pending') return null
          existing.status = 'pending'
          existing.error = null
          return { id: existing.id }
        }
      }
      const entry: MemoryNotification = {
        ...input,
        id: `n_${++seq}`,
        status: 'pending',
        recipient: null,
        subject: '',
        body: '',
        error: null,
        sentAt: null,
      }
      entries.push(entry)
      return { id: entry.id }
    },
    async finish(id, result) {
      const e = entries.find((x) => x.id === id)
      if (!e) return
      e.status = result.status
      e.recipient = result.recipient
      e.subject = result.subject
      e.body = result.body
      e.error = result.error ?? null
      if (result.status === 'sent') e.sentAt = now().toISOString()
    },
    async lastSentAt(kind) {
      const sent = entries.filter((e) => e.kind === kind && e.status === 'sent' && e.sentAt)
      return sent.length
        ? sent
            .map((e) => e.sentAt!)
            .sort()
            .at(-1)!
        : null
    },
  }
}

export function createDbNotificationLog(appId: () => Promise<string>): NotificationLog {
  return {
    async claim(input) {
      const row = await dbOne<{ id: string }>(
        `insert into public.notifications (app_id, kind, dedupe_key, ticket_id, meta, status)
         values ($1, $2, $3, $4, $5::jsonb, 'pending')
         on conflict (kind, dedupe_key) where dedupe_key is not null
         do update set status = 'pending', error = null, created_at = now()
           where public.notifications.status in ('failed', 'skipped')
              or (public.notifications.status = 'pending'
                  and public.notifications.created_at < now() - interval '10 minutes')
         returning id`,
        [
          await appId(),
          input.kind,
          input.dedupeKey,
          input.ticketId ?? null,
          JSON.stringify(input.meta ?? {}),
        ],
      )
      return row ? { id: row.id } : null
    },
    async finish(id, result) {
      await dbQuery(
        `update public.notifications
         set status = $2, recipient = $3, subject = $4, body = $5, error = $6,
             sent_at = case when $2 = 'sent' then now() else sent_at end
         where id = $1`,
        [id, result.status, result.recipient, result.subject, result.body, result.error ?? null],
      )
    },
    async lastSentAt(kind) {
      const row = await dbOne<{ last: Date | string | null }>(
        `select max(sent_at) as last from public.notifications where kind = $1 and status = 'sent'`,
        [kind],
      )
      const v = row?.last
      return v ? (v instanceof Date ? v.toISOString() : String(v)) : null
    },
  }
}
