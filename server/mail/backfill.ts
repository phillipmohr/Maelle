/**
 * Mailbox history import (IRDR-455). Loads everything that is in INBOX and in the Sent folder,
 * oldest first, so the closed view holds every conversation from before Maelle existed and the
 * per-case counts cover all of them. It is not the live fetch: every ticket it creates is closed
 * on arrival with `imported_at` set, no agent run is ever enqueued, and the 30-day threading window
 * is measured from each mail's own date. Our old replies come from the Sent folder and are stored
 * as outbound messages sent by you.
 *
 * State: one `mail_backfills` row per folder (cursor = last handled UID, counters, status). Work
 * happens in chunks (`backfill_mail` job): a chunk lists a page after the cursor, handles it within
 * a time budget, moves the cursor past every handled message (a failed message is counted and
 * skipped, never retried forever) and re-enqueues itself until both folders are done. Everything is
 * idempotent through the Message-ID and provider-id dedupe, so a chunk that dies is simply run again.
 */
import { randomUUID } from 'node:crypto'
import type { MailBackfillProgress } from '#shared/api'
import { MAILBOX } from '#shared/config'
import type { Db } from '../jobs/db'
import { JobQueue } from '../jobs/queue'
import { errorMessage } from '../jobs/types'
import { mailboxDomain } from './config'
import type { MailContext } from './context'
import {
  alreadyKnown,
  clampReceivedAt,
  ingestRaw,
  resolveAppId,
  type IngestResult,
} from './inbound'
import { parseMail, syntheticMessageId } from './parse'
import { stripQuotedText } from './quote'
import { safeFileName } from './storage'
import { findThreadTicket, normalizeSubject, THREAD_FALLBACK_DAYS } from './threading'
import type { MailFolder, ProviderMessageRef, StoredAttachment } from './types'

/** INBOX first, so our replies from Sent find the customer's ticket by In-Reply-To. */
export const BACKFILL_FOLDERS: readonly MailFolder[] = ['inbox', 'sent']

export interface BackfillRow {
  mailbox: string
  folder: MailFolder
  status: 'queued' | 'running' | 'done' | 'failed'
  uid_validity: string | null
  last_uid: number | null
  max_uid: number | null
  listed: number
  imported: number
  skipped: number
  ignored: number
  failed: number
  tickets_created: number
  last_error: string | null
  started_at: Date | null
  finished_at: Date | null
  updated_at: Date
}

const ROW_COLUMNS = `mailbox, folder, status, uid_validity, last_uid::int as last_uid, max_uid::int as max_uid,
  listed, imported, skipped, ignored, failed, tickets_created, last_error, started_at, finished_at, updated_at`

export async function backfillRows(db: Db, mailbox: string): Promise<BackfillRow[]> {
  const rows = await db.query<BackfillRow>(
    `select ${ROW_COLUMNS} from public.mail_backfills where mailbox = $1`,
    [mailbox],
  )
  return BACKFILL_FOLDERS.map((f) => rows.find((r) => r.folder === f)).filter(
    (r): r is BackfillRow => r != null,
  )
}

export function toProgress(row: BackfillRow): MailBackfillProgress {
  return {
    folder: row.folder,
    status: row.status,
    lastUid: row.last_uid,
    maxUid: row.max_uid,
    listed: row.listed,
    imported: row.imported,
    skipped: row.skipped,
    ignored: row.ignored,
    failed: row.failed,
    ticketsCreated: row.tickets_created,
    lastError: row.last_error,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString(),
  }
}

/** True while a folder is queued or running, or a chunk job is pending. */
export async function backfillActive(db: Db, mailbox: string): Promise<boolean> {
  const rows = await backfillRows(db, mailbox)
  if (rows.some((r) => r.status === 'queued' || r.status === 'running')) return true
  return new JobQueue(db).hasPendingOfType('backfill_mail')
}

/**
 * Starts (or restarts) the import: both folders back to the beginning, counters reset, first chunk
 * enqueued. A running import is left alone (`started: false`). Restarting a finished import is
 * safe and cheap on the database side (everything deduplicates); it does re-read the mailbox.
 */
export async function startBackfill(ctx: MailContext): Promise<{ started: boolean }> {
  const { db, config } = ctx
  const now = ctx.now()
  return db.transaction(async (tx) => {
    if (await backfillActive(tx, config.mailbox)) return { started: false }
    for (const folder of BACKFILL_FOLDERS) {
      await tx.query(
        `insert into public.mail_backfills (mailbox, folder, status, started_at)
         values ($1, $2, 'queued', $3)
         on conflict (mailbox, folder) do update set
           status = 'queued', uid_validity = null, last_uid = null, max_uid = null,
           listed = 0, imported = 0, skipped = 0, ignored = 0, failed = 0, tickets_created = 0,
           last_error = null, started_at = excluded.started_at, finished_at = null`,
        [config.mailbox, folder, now],
      )
    }
    await new JobQueue(tx).enqueue('backfill_mail', {}, { runAt: now })
    return { started: true }
  })
}

export interface BackfillChunkResult {
  /** The folder the chunk worked on last (null when nothing was left). */
  folder: MailFolder | null
  listed: number
  imported: number
  skipped: number
  ignored: number
  failed: number
  ticketsCreated: number
  /** Nothing is left in any folder. */
  done: boolean
  /** This chunk finished the last folder (the caller schedules the classify pass once). */
  finishedNow: boolean
}

const zero = () => ({
  listed: 0,
  imported: 0,
  skipped: 0,
  ignored: 0,
  failed: 0,
  ticketsCreated: 0,
})

async function nextFolder(db: Db, mailbox: string): Promise<BackfillRow | null> {
  const rows = await backfillRows(db, mailbox)
  return rows.find((r) => r.status === 'queued' || r.status === 'running') ?? null
}

/** One chunk: lists after the cursor, handles what fits in the budget, moves the cursor. */
export async function runBackfillChunk(
  ctx: MailContext,
  opts: { limit?: number; budgetMs?: number } = {},
): Promise<BackfillChunkResult> {
  const { db, provider, config } = ctx
  const limit = opts.limit ?? MAILBOX.backfill.chunkLimit
  const deadline = Date.now() + (opts.budgetMs ?? MAILBOX.backfill.chunkBudgetMs)
  const totals = zero()
  let folder: MailFolder | null = null
  let finishedNow = false

  while (Date.now() < deadline) {
    const row = await nextFolder(db, config.mailbox)
    if (!row) return { folder, ...totals, done: true, finishedNow }
    folder = row.folder
    if (row.status === 'queued') {
      await db.query(
        `update public.mail_backfills set status = 'running', started_at = coalesce(started_at, $3)
         where mailbox = $1 and folder = $2`,
        [config.mailbox, folder, ctx.now()],
      )
    }
    let page
    try {
      page = await provider.listRange({
        folder,
        afterUid: row.last_uid,
        uidValidity: row.uid_validity,
        limit,
      })
    } catch (e) {
      await db.query(
        `update public.mail_backfills set status = 'failed', last_error = $3 where mailbox = $1 and folder = $2`,
        [config.mailbox, folder, errorMessage(e)],
      )
      throw e
    }
    if (page.reset && row.last_uid != null) {
      ctx.log(
        `[mail] history import: ${folder} UIDVALIDITY changed, listing it again from the start`,
      )
    }
    if (page.messages.length === 0) {
      await db.query(
        `update public.mail_backfills set status = 'done', uid_validity = $3, last_uid = $4, max_uid = $5,
           finished_at = $6 where mailbox = $1 and folder = $2`,
        [config.mailbox, folder, page.uidValidity, page.lastUid, page.maxUid, ctx.now()],
      )
      if (!(await nextFolder(db, config.mailbox))) finishedNow = true
      continue
    }

    const counts = zero()
    const errors: string[] = []
    let lastUid = page.reset ? 0 : (row.last_uid ?? 0)
    for (const ref of page.messages) {
      if (counts.listed > 0 && Date.now() > deadline) break
      counts.listed++
      try {
        const r = await importMessage(ctx, ref)
        if (r === 'skipped') counts.skipped++
        else if (r.outcome === 'ingested') {
          counts.imported++
          if (r.createdTicket) counts.ticketsCreated++
        } else if (r.outcome === 'duplicate') counts.skipped++
        else counts.ignored++
      } catch (e) {
        counts.failed++
        errors.push(`${ref.id}: ${errorMessage(e)}`)
        ctx.log(`[mail] history import of ${ref.id} failed: ${errorMessage(e)}`)
      }
      lastUid = ref.uid ?? lastUid
    }
    await db.query(
      `update public.mail_backfills set uid_validity = $3, last_uid = $4, max_uid = $5,
         listed = listed + $6, imported = imported + $7, skipped = skipped + $8, ignored = ignored + $9,
         failed = failed + $10, tickets_created = tickets_created + $11,
         last_error = coalesce($12, last_error)
       where mailbox = $1 and folder = $2`,
      [
        config.mailbox,
        folder,
        page.uidValidity,
        lastUid,
        page.maxUid,
        counts.listed,
        counts.imported,
        counts.skipped,
        counts.ignored,
        counts.failed,
        counts.ticketsCreated,
        errors.length ? errors.slice(-3).join('; ').slice(0, 2000) : null,
      ],
    )
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += counts[k]
  }
  return { folder, ...totals, done: false, finishedNow }
}

async function importMessage(
  ctx: MailContext,
  ref: ProviderMessageRef,
): Promise<IngestResult | 'skipped'> {
  if (await alreadyKnown(ctx.db, ref.id)) return 'skipped'
  const fetched = await ctx.provider.fetch(ref)
  const idRef = {
    providerMessageId: ref.id,
    providerThreadId: fetched.threadId ?? ref.threadId ?? null,
  }
  return ref.folder === 'sent'
    ? ingestSentRaw(ctx, fetched.raw, idRef)
    : ingestRaw(ctx, fetched.raw, idRef, { mode: 'import' })
}

// ---------------------------------------------------------------- the Sent folder

/**
 * A mail we sent before Maelle: threaded to the customer's ticket by In-Reply-To / References,
 * else by recipient and subject within 30 days on either side, else it opens its own closed ticket
 * for that recipient (we wrote first). Stored as an outbound message sent by you, dated as sent.
 * Mail to our own domain only (forwards to ourselves) is ignored.
 */
export async function ingestSentRaw(
  ctx: MailContext,
  raw: Buffer,
  ref: { providerMessageId: string; providerThreadId?: string | null },
): Promise<IngestResult> {
  const { db, config } = ctx
  const now = ctx.now()
  const parsed = await parseMail(raw)
  const messageId = parsed.messageId ?? syntheticMessageId(raw)
  const dup = await db.one(
    'select 1 as x from public.messages where message_id = $1 or provider_message_id = $2 limit 1',
    [messageId, ref.providerMessageId],
  )
  if (dup) return { outcome: 'duplicate' }

  const domain = mailboxDomain(config.mailbox).toLowerCase()
  const recipients = [...parsed.to, ...parsed.cc]
  const customers = recipients.filter((a) => !a.address.toLowerCase().endsWith(`@${domain}`))
  const sentAt = clampReceivedAt(parsed.date, now)
  if (customers.length === 0) {
    await db.query(
      `insert into public.mail_ignored (provider_message_id, message_id, reason, from_email, subject, received_at)
       values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
      [
        ref.providerMessageId,
        messageId,
        `own: sent to ${recipients.map((a) => a.address).join(', ') || 'nobody'}`,
        parsed.from?.address ?? config.mailbox,
        parsed.subject,
        sentAt,
      ],
    )
    return { outcome: 'ignored', reason: 'own' }
  }
  const customer = customers[0]!
  const appId = await resolveAppId(db, config.mailbox)
  const messageRowId = randomUUID()
  const textStripped = parsed.text ? stripQuotedText(parsed.text) : null

  return db.transaction(async (tx) => {
    // Header threading first; the subject fallback then looks for the recipient's ticket.
    const thread = await findThreadTicket(
      tx,
      { ...parsed, from: { address: customer.address, name: customer.name } },
      { appId, now: sentAt, bounded: true, providerThreadId: ref.providerThreadId ?? null },
    )
    let ticketId = thread?.ticketId ?? null
    let threadedVia = thread?.via ?? null
    if (!ticketId) {
      // We may have written first: the customer's ticket starts within 30 days after this mail.
      const norm = normalizeSubject(parsed.subject)
      if (norm) {
        const until = new Date(sentAt.getTime() + THREAD_FALLBACK_DAYS * 24 * 60 * 60 * 1000)
        const later = await tx.query<{ id: string; subject: string | null }>(
          `select id, subject from public.tickets
           where app_id = $1 and lower(customer_email) = $2
             and coalesce(first_message_at, created_at) between $3 and $4
           order by coalesce(first_message_at, created_at) asc limit 25`,
          [appId, customer.address.toLowerCase(), sentAt, until],
        )
        const hit = later.find((c) => normalizeSubject(c.subject) === norm)
        if (hit) {
          ticketId = hit.id
          threadedVia = 'subject'
        }
      }
    }
    let createdTicket = false
    if (ticketId) {
      await tx.query(
        `update public.tickets set
           first_message_at = least(coalesce(first_message_at, $2), $2),
           last_message_at = greatest(coalesce(last_message_at, $2), $2),
           closed_at = case when status = 'closed' and imported_at is not null
             then greatest(coalesce(closed_at, $2), $2) else closed_at end
         where id = $1`,
        [ticketId, sentAt],
      )
    } else {
      ticketId = randomUUID()
      createdTicket = true
      await tx.query(
        `insert into public.tickets (id, app_id, customer_email, customer_name, subject, status,
           first_message_at, last_message_at, closed_at, imported_at, created_at)
         values ($1, $2, $3, $4, $5, 'closed', $6, $6, $6, $7, $6)`,
        [
          ticketId,
          appId,
          customer.address,
          customer.name,
          parsed.subject ?? '(no subject)',
          sentAt,
          now,
        ],
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
         text_stripped, attachments, headers, raw_storage_path, sent_at, sent_by, created_at)
       values ($1, $2, 'out', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::jsonb, $18, $19, 'you', $19)
       on conflict do nothing returning id`,
      [
        messageRowId,
        ticketId,
        ref.providerMessageId,
        ref.providerThreadId ?? null,
        messageId,
        parsed.inReplyTo,
        parsed.references,
        parsed.from?.address ?? config.mailbox,
        parsed.from?.name ?? config.fromName,
        parsed.to.map((a) => a.address),
        parsed.cc.map((a) => a.address),
        parsed.subject,
        parsed.text,
        parsed.html,
        textStripped,
        JSON.stringify(attachments),
        JSON.stringify(parsed.headers),
        rawPath,
        sentAt,
      ],
    )
    if (!inserted[0]) return { outcome: 'duplicate' }
    await ctx.store.put(rawPath, raw, 'message/rfc822')
    for (const [i, a] of parsed.attachments.entries()) {
      await ctx.store.put(attachments[i]!.storagePath, a.content, a.contentType)
    }
    return {
      outcome: 'ingested',
      ticketId,
      messageRowId,
      createdTicket,
      enqueuedTrigger: null,
      threadedVia,
    }
  })
}
