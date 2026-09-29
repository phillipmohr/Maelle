/**
 * Inbound pipeline (IRDR-455): list new mail since the cursor, parse, classify, thread, store,
 * enqueue the agent run. Every step is idempotent: messages are deduplicated by Message-ID and
 * provider id, a ticket and its first message are created in one transaction with the agent job,
 * and the cursor only advances after every listed message was handled, so a killed run is simply
 * repeated on the next tick without duplicates.
 */
import { randomUUID } from 'node:crypto'
import type { AgentTrigger } from '#shared/services'
import { transition, type TicketStatus } from '#shared/status'
import type { Db } from '../jobs/db'
import { JobQueue } from '../jobs/queue'
import { errorMessage } from '../jobs/types'
import { classifyInbound, type IgnoreReason } from './classify'
import type { MailContext } from './context'
import { mailboxDomain } from './config'
import { parseMail, syntheticMessageId, type ParsedMail } from './parse'
import { stripQuotedText } from './quote'
import { safeFileName } from './storage'
import { findThreadTicket } from './threading'
import type { StoredAttachment } from './types'

export interface FetchMailResult {
  fetched: number
  ingested: number
  /** Already known (dedupe). */
  skipped: number
  /** Auto-replies, bounces, bulk, own mail. */
  ignored: number
  failed: number
  ticketsCreated: number
  reset: boolean
  cursor: string | null
}

export type IngestResult =
  | {
      outcome: 'ingested'
      ticketId: string
      messageRowId: string
      createdTicket: boolean
      enqueuedTrigger: AgentTrigger | null
      threadedVia: 'headers' | 'provider_thread' | 'subject' | null
    }
  | { outcome: 'duplicate' }
  | { outcome: 'ignored'; reason: IgnoreReason }

export interface IngestOptions {
  /**
   * `import` (history import, IRDR-455): the mail is old and was answered long ago. A new ticket is
   * created closed with `imported_at` set, an existing ticket keeps its status, no agent run is
   * enqueued, and the 30-day threading window is measured from the mail's own date.
   */
  mode: 'live' | 'import'
}

class AlreadyIngestedError extends Error {
  constructor() {
    super('message already ingested')
    this.name = 'AlreadyIngestedError'
  }
}

export async function alreadyKnown(db: Db, providerMessageId: string): Promise<boolean> {
  const row = await db.one(
    `select 1 as x from public.messages where provider_message_id = $1
     union all
     select 1 as x from public.mail_ignored where provider_message_id = $1
     limit 1`,
    [providerMessageId],
  )
  return row != null
}

export async function fetchMail(ctx: MailContext): Promise<FetchMailResult> {
  const { db, provider, config } = ctx
  const cursorRow = await db.one<{
    provider: string
    cursor: string | null
    cursor_meta: Record<string, unknown> | null
  }>('select provider, cursor, cursor_meta from public.mail_cursors where mailbox = $1', [
    config.mailbox,
  ])
  const cursor =
    cursorRow && cursorRow.provider === provider.kind && cursorRow.cursor
      ? { value: cursorRow.cursor, meta: cursorRow.cursor_meta ?? {} }
      : null
  const listed = await provider.listNew(cursor, {
    limit: config.fetchLimit,
    bootstrapDays: config.bootstrapDays,
    now: ctx.now(),
  })
  const result: FetchMailResult = {
    fetched: listed.messages.length,
    ingested: 0,
    skipped: 0,
    ignored: 0,
    failed: 0,
    ticketsCreated: 0,
    reset: listed.reset,
    cursor: listed.nextCursor.value,
  }
  const errors: string[] = []
  for (const ref of listed.messages) {
    try {
      if (await alreadyKnown(db, ref.id)) {
        result.skipped++
        continue
      }
      const fetched = await provider.fetch(ref)
      const r = await ingestRaw(ctx, fetched.raw, {
        providerMessageId: ref.id,
        providerThreadId: fetched.threadId ?? ref.threadId ?? null,
      })
      if (r.outcome === 'ingested') {
        result.ingested++
        if (r.createdTicket) result.ticketsCreated++
      } else if (r.outcome === 'duplicate') {
        result.skipped++
      } else {
        result.ignored++
      }
      if (config.markRead) {
        await provider
          .markProcessed(ref)
          .catch((e) => ctx.log(`[mail] markProcessed ${ref.id} failed: ${errorMessage(e)}`))
      }
    } catch (e) {
      result.failed++
      errors.push(`${ref.id}: ${errorMessage(e)}`)
      ctx.log(`[mail] ingest of ${ref.id} failed: ${errorMessage(e)}`)
    }
  }
  const advance = result.failed === 0
  await db.query(
    `insert into public.mail_cursors as c (mailbox, provider, cursor, cursor_meta, last_fetch_at, last_result, updated_at)
     values ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $5)
     on conflict (mailbox) do update set
       provider = excluded.provider,
       cursor = case when $7::boolean then excluded.cursor else c.cursor end,
       cursor_meta = case when $7::boolean then excluded.cursor_meta else c.cursor_meta end,
       last_fetch_at = excluded.last_fetch_at,
       last_result = excluded.last_result,
       updated_at = excluded.updated_at`,
    [
      config.mailbox,
      provider.kind,
      advance ? listed.nextCursor.value : null,
      JSON.stringify(advance ? (listed.nextCursor.meta ?? {}) : {}),
      ctx.now(),
      JSON.stringify({ ...result, at: ctx.now().toISOString(), errors: errors.slice(0, 5) }),
      advance,
    ],
  )
  if (!advance) {
    // The cursor stays put so the failed messages are listed again; handled ones are skipped by dedupe.
    throw new Error(
      `mail fetch: ${result.failed} of ${result.fetched} message(s) failed: ${errors.slice(0, 3).join('; ')}`,
    )
  }
  return result
}

/** How a customer message changes an existing ticket. Statuses without a path to researching keep theirs. */
export function customerReplyDecision(status: TicketStatus): {
  next: TicketStatus | null
  trigger: AgentTrigger | null
} {
  switch (status) {
    case 'new':
      // The queued new_ticket run has not started; it reads every message when it does.
      return { next: null, trigger: null }
    case 'waiting_on_customer':
    case 'closed':
    case 'snoozed':
    case 'needs_decision':
      return { next: transition(status, 'researching'), trigger: 'customer_reply' }
    default:
      // researching, executing, action_failed, manual, auto_pending: attach and re-run; the agent
      // decides what the reply means for a ticket in that state.
      return { next: null, trigger: 'customer_reply' }
  }
}

export async function resolveAppId(db: Db, mailbox: string): Promise<string> {
  const row = await db.one<{ id: string }>(
    `select id from public.apps where lower(support_mailbox) = lower($1) or key = 'instaradar'
     order by (lower(support_mailbox) = lower($1)) desc limit 1`,
    [mailbox],
  )
  if (!row) throw new Error(`no app for mailbox ${mailbox} (apps table is empty)`)
  return row.id
}

export function clampReceivedAt(date: Date | null, now: Date): Date {
  if (!date) return now
  return date.getTime() > now.getTime() ? now : date
}

export async function ingestRaw(
  ctx: MailContext,
  raw: Buffer,
  ref: { providerMessageId: string; providerThreadId?: string | null },
  opts: IngestOptions = { mode: 'live' },
): Promise<IngestResult> {
  const { db, config } = ctx
  const now = ctx.now()
  const importing = opts.mode === 'import'
  const parsed = await parseMail(raw)
  const messageId = parsed.messageId ?? syntheticMessageId(raw)

  const dup = await db.one(
    'select 1 as x from public.messages where message_id = $1 or provider_message_id = $2 limit 1',
    [messageId, ref.providerMessageId],
  )
  if (dup) return { outcome: 'duplicate' }

  const cls = classifyInbound(parsed, { mailbox: config.mailbox })
  if (cls.kind === 'ignore') {
    await db.query(
      `insert into public.mail_ignored (provider_message_id, message_id, reason, from_email, subject, received_at)
       values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
      [
        ref.providerMessageId,
        messageId,
        `${cls.reason}: ${cls.detail}`,
        parsed.from?.address ?? null,
        parsed.subject,
        clampReceivedAt(parsed.date, now),
      ],
    )
    if (cls.reason === 'bounce') await alertIfOurMailBounced(ctx, parsed)
    return { outcome: 'ignored', reason: cls.reason }
  }
  const from = parsed.from!
  const appId = await resolveAppId(db, config.mailbox)
  const receivedAt = clampReceivedAt(parsed.date, now)
  const messageRowId = randomUUID()
  const textStripped = parsed.text ? stripQuotedText(parsed.text) : null

  try {
    return await db.transaction(async (tx) => {
      const thread = await findThreadTicket(tx, parsed, {
        appId,
        // History: the window is measured from the mail's date, not from today, on both sides.
        now: importing ? receivedAt : now,
        bounded: importing,
        providerThreadId: ref.providerThreadId ?? null,
      })
      let ticketId: string
      let createdTicket = false
      let trigger: AgentTrigger | null
      if (thread && importing) {
        // An old mail joining a thread: the timestamps widen, the status and the queue stay as they are.
        ticketId = thread.ticketId
        trigger = null
        await tx.query(
          `update public.tickets set
             first_message_at = least(coalesce(first_message_at, $2), $2),
             last_message_at = greatest(coalesce(last_message_at, $2), $2),
             last_customer_message_at = greatest(coalesce(last_customer_message_at, $2), $2),
             closed_at = case when status = 'closed' and imported_at is not null
               then greatest(coalesce(closed_at, $2), $2) else closed_at end
           where id = $1`,
          [ticketId, receivedAt],
        )
      } else if (thread) {
        ticketId = thread.ticketId
        const ticket = await tx.one<{ status: TicketStatus }>(
          'select status from public.tickets where id = $1 for update',
          [ticketId],
        )
        if (!ticket) throw new Error(`ticket ${ticketId} vanished while threading`)
        const decision = customerReplyDecision(ticket.status)
        trigger = decision.trigger
        await tx.query(
          `update public.tickets set
             status = coalesce($2, status),
             snoozed_until = case when $2 is not null then null else snoozed_until end,
             closed_at = case when $2 is not null then null else closed_at end,
             resolution = case when $2 is not null then null else resolution end,
             last_message_at = greatest(coalesce(last_message_at, $3), $3),
             last_customer_message_at = greatest(coalesce(last_customer_message_at, $3), $3)
           where id = $1`,
          [ticketId, decision.next, receivedAt],
        )
      } else if (importing) {
        // History: closed on arrival, marked imported, classified later by the classify-only pass.
        ticketId = randomUUID()
        createdTicket = true
        trigger = null
        await tx.query(
          `insert into public.tickets (id, app_id, customer_email, customer_name, subject, status,
             first_message_at, last_message_at, last_customer_message_at, closed_at, imported_at, created_at)
           values ($1, $2, $3, $4, $5, 'closed', $6, $6, $6, $6, $7, $6)`,
          [
            ticketId,
            appId,
            from.address,
            from.name,
            parsed.subject ?? '(no subject)',
            receivedAt,
            now,
          ],
        )
      } else {
        ticketId = randomUUID()
        createdTicket = true
        trigger = 'new_ticket'
        await tx.query(
          `insert into public.tickets (id, app_id, customer_email, customer_name, subject, status,
             first_message_at, last_message_at, last_customer_message_at)
           values ($1, $2, $3, $4, $5, 'new', $6, $6, $6)`,
          [ticketId, appId, from.address, from.name, parsed.subject ?? '(no subject)', receivedAt],
        )
      }

      const attachments: StoredAttachment[] = parsed.attachments.map((a, i) => ({
        name: a.filename ?? `attachment-${i + 1}`,
        storagePath: `tickets/${ticketId}/${messageRowId}/${i}-${safeFileName(a.filename)}`,
        contentType: a.contentType,
        sizeBytes: a.size,
        ...(a.inline ? { inline: true } : {}),
        ...(a.contentId ? { contentId: a.contentId } : {}),
      }))
      const rawPath = `raw/${ticketId}/${messageRowId}.eml`
      const inserted = await tx.query<{ id: string }>(
        `insert into public.messages (id, ticket_id, direction, provider_message_id, provider_thread_id, message_id,
           in_reply_to, "references", from_email, from_name, to_emails, cc_emails, subject, text_body, html_body,
           text_stripped, attachments, headers, raw_storage_path, received_at, created_at)
         values ($1, $2, 'in', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18, $19, $20)
         on conflict do nothing returning id`,
        [
          messageRowId,
          ticketId,
          ref.providerMessageId,
          ref.providerThreadId ?? null,
          messageId,
          parsed.inReplyTo,
          parsed.references,
          from.address,
          from.name,
          parsed.to.map((a) => a.address),
          parsed.cc.map((a) => a.address),
          parsed.subject,
          parsed.text,
          parsed.html,
          textStripped,
          JSON.stringify(attachments),
          JSON.stringify(parsed.headers),
          rawPath,
          receivedAt,
          // History: the thread is ordered by created_at, so old mail keeps its own date.
          importing ? receivedAt : now,
        ],
      )
      if (!inserted[0]) throw new AlreadyIngestedError()

      // Storage writes happen inside the transaction window: a failure rolls everything back and the
      // message is ingested again on the next fetch. Orphaned files are harmless.
      await ctx.store.put(rawPath, raw, 'message/rfc822')
      for (const [i, a] of parsed.attachments.entries()) {
        await ctx.store.put(attachments[i]!.storagePath, a.content, a.contentType)
      }

      if (trigger) {
        await new JobQueue(tx).enqueue(
          'agent_run',
          { ticketId, trigger },
          { dedupeKey: `agent_run:${ticketId}:${trigger}:${messageRowId}`, runAt: now },
        )
      }
      return {
        outcome: 'ingested',
        ticketId,
        messageRowId,
        createdTicket,
        enqueuedTrigger: trigger,
        threadedVia: thread?.via ?? null,
      }
    })
  } catch (e) {
    if (e instanceof AlreadyIngestedError) return { outcome: 'duplicate' }
    throw e
  }
}

/** A bounce that references one of our replies is worth an alert; other bounces are just ignored. */
async function alertIfOurMailBounced(ctx: MailContext, mail: ParsedMail): Promise<void> {
  const domain = mailboxDomain(ctx.config.mailbox).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const inText = [...(mail.text ?? '').matchAll(new RegExp(`<[^<>\\s]+@${domain}>`, 'gi'))].map(
    (m) => m[0],
  )
  const ids = [
    ...new Set([mail.inReplyTo, ...mail.references, ...inText].filter(Boolean)),
  ] as string[]
  if (!ids.length) return
  const hit = await ctx.db.one<{ display_number: number; ticket_id: string; to_emails: string[] }>(
    `select t.display_number, m.ticket_id, m.to_emails from public.messages m
     join public.tickets t on t.id = m.ticket_id
     where m.direction = 'out' and m.message_id = any ($1::text[]) limit 1`,
    [ids],
  )
  if (!hit) return
  try {
    await ctx.notify('system_alert', {
      title: `Reply on ticket #${hit.display_number} bounced`,
      detail: `Our mail to ${hit.to_emails.join(', ')} came back: ${mail.subject ?? 'delivery failure'}. The customer did not receive it.`,
      source: 'mail',
    })
  } catch (e) {
    ctx.log(`[mail] bounce alert failed: ${errorMessage(e)}`)
  }
}
