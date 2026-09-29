/**
 * Outbound mail (IRDR-455), exactly once. Every send is keyed in `mail_sends`: the row is claimed
 * as `sending` with a pre-generated Message-ID, then the provider sends, then the row becomes
 * `sent` and the message is stored. A retry that finds `sent` returns it without sending. A row
 * stuck in `sending` (crash between send and record) is taken over after MAILBOX.stuckSendMinutes,
 * but the provider is asked for the Message-ID first, so nothing goes out twice.
 */
import { createHash, randomUUID } from 'node:crypto'
import type { ReplyDraft } from '#shared/proposal'
import type { SentMail } from '#shared/services'
import type { Db } from '../jobs/db'
import { errorMessage } from '../jobs/types'
import {
  buildMime,
  newMessageId,
  replyHtml,
  replySubject,
  signaturePhotoAttachment,
  textToHtml,
  withSignature,
} from './compose'
import { MailConfigError, mailboxDomain } from './config'
import type { MailContext } from './context'
import { normalizeSubject } from './threading'
import type { OutgoingAttachment, OutgoingMail, SendResult, StoredAttachment } from './types'

export class SendInProgressError extends Error {
  readonly retryable = true
  constructor(key: string) {
    super(`send ${key} is in progress on another worker; retry later`)
    this.name = 'SendInProgressError'
  }
}

interface MailSendRow {
  idempotency_key: string
  ticket_id: string | null
  kind: 'reply' | 'system'
  status: 'sending' | 'sent' | 'failed'
  attempts: number
  rfc_message_id: string
  provider_message_id: string | null
  message_row_id: string | null
  inserted?: boolean
}

type Acquired =
  | { state: 'acquired'; row: MailSendRow; takeover: boolean }
  | { state: 'sent'; row: MailSendRow }
  | { state: 'in_progress' }

async function acquireSend(
  db: Db,
  input: {
    key: string
    ticketId: string | null
    kind: 'reply' | 'system'
    to: string[]
    subject: string
    rfcMessageId: string
    now: Date
    stuckMinutes: number
  },
): Promise<Acquired> {
  const rows = await db.query<MailSendRow>(
    `insert into public.mail_sends as s (idempotency_key, ticket_id, kind, status, to_emails, subject, rfc_message_id, started_at, attempts)
     values ($1, $2, $3, 'sending', $4, $5, $6, $7, 1)
     on conflict (idempotency_key) do update
       set status = 'sending', started_at = $7, attempts = s.attempts + 1, last_error = null
       where s.status = 'failed'
          or (s.status = 'sending' and s.started_at < $7::timestamptz - make_interval(mins => $8))
     returning *, (xmax = 0) as inserted`,
    [
      input.key,
      input.ticketId,
      input.kind,
      input.to,
      input.subject,
      input.rfcMessageId,
      input.now,
      input.stuckMinutes,
    ],
  )
  const row = rows[0]
  if (row) return { state: 'acquired', row, takeover: !row.inserted }
  const existing = await db.one<MailSendRow>(
    'select * from public.mail_sends where idempotency_key = $1',
    [input.key],
  )
  if (existing?.status === 'sent') return { state: 'sent', row: existing }
  return { state: 'in_progress' }
}

async function markSendFailed(db: Db, key: string, error: unknown): Promise<void> {
  await db.query(
    `update public.mail_sends set status = 'failed', last_error = $2
     where idempotency_key = $1 and status = 'sending'`,
    [key, errorMessage(error)],
  )
}

async function loadAttachments(
  ctx: MailContext,
  attachments: StoredAttachment[] | undefined,
): Promise<OutgoingAttachment[]> {
  const out: OutgoingAttachment[] = []
  for (const a of attachments ?? []) {
    const content = await ctx.store.get(a.storagePath)
    if (!content) throw new Error(`attachment ${a.storagePath} is missing from storage`)
    out.push({ filename: a.name, content, contentType: a.contentType })
  }
  return out
}

function draftHash(draft: ReplyDraft, cc: string[] = []): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        to: draft.to,
        cc,
        subject: draft.subject,
        body: draft.body,
        attachments: (draft.attachments ?? []).map((a) => a.storagePath),
      }),
    )
    .digest('hex')
    .slice(0, 32)
}

/** Sends the draft into the ticket's thread. Exactly once per idempotency key (default: the draft's hash). */
export async function sendReply(
  ctx: MailContext,
  ticketId: string,
  draft: ReplyDraft,
  opts: { sentBy?: 'you' | 'auto'; idempotencyKey?: string; cc?: string[] } = {},
): Promise<SentMail> {
  const { db, config, provider } = ctx
  const now = ctx.now()
  const ticket = await db.one<{ id: string; subject: string | null; customer_email: string }>(
    'select id, subject, customer_email from public.tickets where id = $1',
    [ticketId],
  )
  if (!ticket) throw new Error(`sendReply: ticket ${ticketId} does not exist`)
  const latestIn = await db.one<{
    message_id: string | null
    references: string[]
    provider_thread_id: string | null
    subject: string | null
  }>(
    `select message_id, "references", provider_thread_id, subject from public.messages
     where ticket_id = $1 and direction = 'in'
     order by coalesce(received_at, created_at) desc limit 1`,
    [ticketId],
  )
  // Threaded replies keep the thread's subject (mail clients thread on it); a fresh mail keeps the draft's.
  const threadSubject = latestIn ? (latestIn.subject ?? ticket.subject) : null
  const subject = threadSubject
    ? normalizeSubject(draft.subject) === normalizeSubject(threadSubject)
      ? replySubject(draft.subject)
      : replySubject(threadSubject)
    : draft.subject.trim()
  const cc = [
    ...new Set((opts.cc ?? []).map((a) => a.trim().toLowerCase()).filter(Boolean)),
  ].filter((a) => a !== draft.to.toLowerCase())
  const key = `reply:${ticketId}:${opts.idempotencyKey ?? draftHash(draft, cc)}`

  const acquired = await acquireSend(db, {
    key,
    ticketId,
    kind: 'reply',
    to: [draft.to],
    subject,
    rfcMessageId: newMessageId(mailboxDomain(config.mailbox)),
    now,
    stuckMinutes: config.stuckSendMinutes,
  })
  if (acquired.state === 'in_progress') throw new SendInProgressError(key)
  if (acquired.state === 'sent') {
    return {
      messageId: acquired.row.message_row_id ?? '',
      providerMessageId: acquired.row.provider_message_id ?? '',
      rfcMessageId: acquired.row.rfc_message_id,
    }
  }
  const rfcMessageId = acquired.row.rfc_message_id
  const references = latestIn
    ? [...latestIn.references, latestIn.message_id].filter((x): x is string => Boolean(x))
    : []
  const text = withSignature(draft.body)
  const mail: OutgoingMail = {
    from: { name: config.fromName, address: config.mailbox },
    to: [draft.to],
    ...(cc.length ? { cc } : {}),
    subject,
    text,
    html: replyHtml(draft.body),
    messageId: rfcMessageId,
    inReplyTo: latestIn?.message_id ?? null,
    references,
    threadId: latestIn?.provider_thread_id ?? null,
    date: now,
  }
  let sent: SendResult | null = null
  try {
    mail.attachments = [
      signaturePhotoAttachment(),
      ...(await loadAttachments(ctx, draft.attachments)),
    ]
    // Taking over a stale row: the previous worker may have sent and died before recording.
    if (acquired.takeover) sent = await provider.findSentByRfcMessageId(rfcMessageId)
    if (!sent) sent = await provider.send(mail)
  } catch (e) {
    await markSendFailed(db, key, e)
    throw e
  }

  const messageRowId = randomUUID()
  const rawPath = `raw/${ticketId}/${messageRowId}.eml`
  try {
    await ctx.store.put(rawPath, await buildMime(mail), 'message/rfc822')
  } catch (e) {
    ctx.log(`[mail] could not store the raw copy of ${rfcMessageId}: ${errorMessage(e)}`)
  }
  await db.transaction(async (tx) => {
    await tx.query(
      `insert into public.messages (id, ticket_id, direction, provider_message_id, provider_thread_id, message_id,
         in_reply_to, "references", from_email, from_name, to_emails, cc_emails, subject, text_body, html_body, text_stripped,
         attachments, raw_storage_path, sent_at, sent_by)
       values ($1, $2, 'out', $3, $4, $5, $6, $7, $8, $9, $10, $18, $11, $12, $13, $12, $14::jsonb, $15, $16, $17)`,
      [
        messageRowId,
        ticketId,
        sent!.providerMessageId,
        sent!.threadId ?? mail.threadId ?? null,
        rfcMessageId,
        mail.inReplyTo,
        references,
        config.mailbox,
        config.fromName,
        [draft.to],
        subject,
        text,
        mail.html,
        JSON.stringify(draft.attachments ?? []),
        rawPath,
        now,
        opts.sentBy ?? 'you',
        cc,
      ],
    )
    await tx.query(
      `update public.mail_sends set status = 'sent', provider_message_id = $2, message_row_id = $3, sent_at = $4, last_error = null
       where idempotency_key = $1`,
      [key, sent!.providerMessageId, messageRowId, now],
    )
    await tx.query(
      `update public.tickets set last_message_at = greatest(coalesce(last_message_at, $2), $2) where id = $1`,
      [ticketId, now],
    )
  })
  return { messageId: messageRowId, providerMessageId: sent!.providerMessageId, rfcMessageId }
}

/** Alerts and digests. Same exactly-once path; identical mails are sent once per day. */
export async function sendSystemEmail(
  ctx: MailContext,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  const { db, config, provider } = ctx
  const recipient = (to || config.notifyEmail || '').trim()
  if (!recipient) throw new MailConfigError('sendSystemEmail: no recipient')
  const now = ctx.now()
  const hash = createHash('sha256')
    .update(`${recipient}\n${subject}\n${body}`)
    .digest('hex')
    .slice(0, 32)
  const key = `system:${now.toISOString().slice(0, 10)}:${hash}`
  const acquired = await acquireSend(db, {
    key,
    ticketId: null,
    kind: 'system',
    to: [recipient],
    subject,
    rfcMessageId: newMessageId(mailboxDomain(config.mailbox)),
    now,
    stuckMinutes: config.stuckSendMinutes,
  })
  if (acquired.state === 'sent') return
  if (acquired.state === 'in_progress') throw new SendInProgressError(key)
  const mail: OutgoingMail = {
    from: { name: config.fromName, address: config.mailbox },
    to: [recipient],
    subject,
    text: body,
    html: textToHtml(body),
    messageId: acquired.row.rfc_message_id,
    date: now,
  }
  let sent: SendResult | null = null
  try {
    if (acquired.takeover) sent = await provider.findSentByRfcMessageId(mail.messageId)
    if (!sent) sent = await provider.send(mail)
  } catch (e) {
    await markSendFailed(db, key, e)
    throw e
  }
  await db.query(
    `update public.mail_sends set status = 'sent', provider_message_id = $2, sent_at = $3, last_error = null
     where idempotency_key = $1`,
    [key, sent.providerMessageId, now],
  )
}
