/**
 * Mail pipeline types (IRDR-455). The provider interface hides Gmail, IMAP/SMTP and the in-memory
 * fake behind the same four operations: list new messages since a cursor, fetch raw MIME, send
 * with threading headers, and find a sent mail by its Message-ID (exactly-once recovery).
 */

export type MailProviderKind = 'imap' | 'fake'

export interface MailCursor {
  /** Gmail: historyId · IMAP: last seen UID · fake: number of messages seen. */
  value: string
  /** Provider specific, e.g. IMAP uidValidity. */
  meta?: Record<string, unknown>
}

export type MailFolder = 'inbox' | 'sent'

export interface ProviderMessageRef {
  /** Gmail message id · IMAP `${uidValidity}:${uid}` · fake id. Stored as messages.provider_message_id. */
  id: string
  threadId?: string | null
  /** Folder the message lives in (history import); INBOX when absent. */
  folder?: MailFolder
  /** Position in the folder (IMAP UID, or index + 1 for the fakes); the history import's cursor. */
  uid?: number
}

export interface ListNewOptions {
  limit: number
  /** Without a cursor (first run, expired cursor): how far back to look. */
  bootstrapDays: number
  now: Date
}

export interface ListNewResult {
  messages: ProviderMessageRef[]
  nextCursor: MailCursor
  /** True when the cursor was invalid or missing and the provider started from `bootstrapDays`. */
  reset: boolean
}

/** History import (IRDR-455): one page of a folder by UID, oldest first. */
export interface ListRangeOptions {
  folder: MailFolder
  /** Only UIDs above this; null starts at the beginning. Ignored when `uidValidity` no longer matches. */
  afterUid: number | null
  /** UIDVALIDITY the cursor belongs to (null on the first page). */
  uidValidity: string | null
  limit: number
}

export interface ListRangeResult {
  messages: ProviderMessageRef[]
  uidValidity: string
  /** Highest UID in the folder right now (progress denominator). */
  maxUid: number
  /** Cursor after this page: the last listed UID, or `maxUid` when nothing was left to list. */
  lastUid: number
  /** True when the cursor's UIDVALIDITY did not match and the listing restarted from the beginning. */
  reset: boolean
}

export interface FetchedRaw {
  raw: Buffer
  threadId: string | null
}

export interface OutgoingAttachment {
  filename: string
  content: Buffer
  contentType?: string
}

export interface OutgoingMail {
  from: { name: string; address: string }
  to: string[]
  cc?: string[]
  subject: string
  text: string
  html: string
  /** RFC 5322 Message-ID including angle brackets; generated before the provider call. */
  messageId: string
  inReplyTo?: string | null
  references?: string[]
  attachments?: OutgoingAttachment[]
  /** Provider thread hint (Gmail threadId of the inbound message). */
  threadId?: string | null
  date?: Date
}

export interface SendResult {
  providerMessageId: string
  threadId: string | null
}

export interface MailProvider {
  readonly kind: MailProviderKind
  listNew(cursor: MailCursor | null, opts: ListNewOptions): Promise<ListNewResult>
  /** History import: a page of INBOX or the Sent folder by UID, oldest first. */
  listRange(opts: ListRangeOptions): Promise<ListRangeResult>
  fetch(ref: ProviderMessageRef): Promise<FetchedRaw>
  /** Sends and makes the mail appear in the mailbox's Sent folder like a normal reply. */
  send(mail: OutgoingMail): Promise<SendResult>
  /** Looks for an already sent mail (retry after a crash between send and record). */
  findSentByRfcMessageId(rfcMessageId: string): Promise<SendResult | null>
  /** Optional: mark as read / label after ingest. */
  markProcessed(ref: ProviderMessageRef): Promise<void>
}

export interface AttachmentStore {
  readonly kind: 'supabase' | 'memory'
  put(path: string, data: Buffer, contentType?: string): Promise<void>
  get(path: string): Promise<Buffer | null>
}

/** Attachment metadata as stored in messages.attachments (shared AttachmentSchema plus inline info). */
export interface StoredAttachment {
  name: string
  storagePath: string
  contentType?: string
  sizeBytes?: number
  inline?: boolean
  contentId?: string
}
