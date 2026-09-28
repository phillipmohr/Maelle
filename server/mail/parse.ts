/**
 * MIME parsing (IRDR-455) on top of mailparser: addresses, threading headers, text and HTML,
 * attachments, and the handful of headers the classifier needs. HTML-only mails get their text
 * from our own converter so quoted history is marked consistently.
 */
import { createHash } from 'node:crypto'
import {
  simpleParser,
  type AddressObject,
  type Attachment as MpAttachment,
  type HeaderValue,
} from 'mailparser'
import { htmlToText } from './quote'

export interface ParsedAddress {
  address: string
  name: string | null
}

export interface ParsedAttachment {
  filename: string | null
  contentType: string
  size: number
  content: Buffer
  contentId: string | null
  inline: boolean
}

export interface ParsedMail {
  messageId: string | null
  inReplyTo: string | null
  references: string[]
  from: ParsedAddress | null
  replyTo: ParsedAddress | null
  to: ParsedAddress[]
  cc: ParsedAddress[]
  subject: string | null
  date: Date | null
  /** Text part, or the HTML converted to text when there is none. */
  text: string | null
  html: string | null
  /** True when the text came from the HTML part. */
  textFromHtml: boolean
  attachments: ParsedAttachment[]
  /** Selected headers, lower-cased names, text values. */
  headers: Record<string, string>
  /** Top-level media type, e.g. multipart/report. */
  contentType: string | null
  reportType: string | null
}

/** Headers kept on the message row and used by the classifier. */
export const KEPT_HEADERS = [
  'auto-submitted',
  'precedence',
  'x-autoreply',
  'x-autorespond',
  'x-auto-response-suppress',
  'x-failed-recipients',
  'list-id',
  'list-unsubscribe',
  'return-path',
  'reply-to',
  'delivered-to',
  'x-original-to',
  'x-mailer',
  'user-agent',
  'x-priority',
  'date',
] as const

function headerText(value: HeaderValue | undefined): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return (value as unknown[]).map((v) => headerText(v as HeaderValue) ?? '').join(', ')
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const o = value as { text?: unknown; value?: unknown }
    if (typeof o.text === 'string') return o.text
    if (typeof o.value === 'string') return o.value
    if (Array.isArray(o.value)) {
      return (o.value as { address?: string; name?: string }[])
        .map((a) => a.address ?? a.name ?? '')
        .filter(Boolean)
        .join(', ')
    }
  }
  return String(value)
}

function addresses(v: AddressObject | AddressObject[] | undefined): ParsedAddress[] {
  const list = Array.isArray(v) ? v : v ? [v] : []
  const out: ParsedAddress[] = []
  for (const group of list) {
    for (const a of group.value ?? []) {
      // Group syntax nests addresses under `group`.
      const nested = (a as { group?: { address?: string; name?: string }[] }).group
      const members = nested ?? [a]
      for (const m of members) {
        const address = (m.address ?? '').trim().toLowerCase()
        if (!address || !address.includes('@')) continue
        out.push({ address, name: m.name?.trim() || null })
      }
    }
  }
  return out
}

/** `<id>` normalisation: trims and adds angle brackets when missing. */
export function normalizeMessageId(id: string | null | undefined): string | null {
  const t = (id ?? '').trim()
  if (!t) return null
  const inner = t.replace(/^<+|>+$/g, '').trim()
  if (!inner) return null
  return `<${inner}>`
}

export function normalizeReferences(refs: string | string[] | undefined): string[] {
  const list = Array.isArray(refs) ? refs : refs ? refs.split(/\s+/) : []
  const out: string[] = []
  for (const r of list) {
    const id = normalizeMessageId(r)
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

/** Deterministic stand-in Message-ID for mail without one (dedupe still works). */
export function syntheticMessageId(raw: Buffer | string): string {
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 40)
  return `<${hash}@missing-message-id.maelle.local>`
}

export async function parseMail(raw: Buffer | string): Promise<ParsedMail> {
  const source = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw
  const mail = await simpleParser(source, {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
    skipTextLinks: true,
  })

  const headers: Record<string, string> = {}
  for (const name of KEPT_HEADERS) {
    const v = headerText(mail.headers.get(name))
    if (v != null && v !== '') headers[name] = v
    // An empty Return-Path ("<>", the null sender) is the classic bounce marker; keep it visible.
    else if (name === 'return-path' && mail.headers.has(name)) headers[name] = '<>'
  }
  const ct = mail.headers.get('content-type') as
    { value?: string; params?: Record<string, string> } | undefined
  const contentType = typeof ct?.value === 'string' ? ct.value.toLowerCase() : null
  const reportType = ct?.params?.['report-type']?.toLowerCase() ?? null

  const html = typeof mail.html === 'string' && mail.html.trim() ? mail.html : null
  let text = typeof mail.text === 'string' && mail.text.trim() ? mail.text : null
  let textFromHtml = false
  if (!text && html) {
    text = htmlToText(html)
    textFromHtml = true
  }

  const attachments: ParsedAttachment[] = (mail.attachments ?? []).map((a: MpAttachment) => ({
    filename: a.filename ?? null,
    contentType: a.contentType || 'application/octet-stream',
    size: a.size ?? a.content.length,
    content: a.content,
    contentId: a.contentId ? normalizeMessageId(a.contentId) : null,
    inline: Boolean(a.related) || (a.contentDisposition === 'inline' && Boolean(a.contentId)),
  }))

  const from = addresses(mail.from)[0] ?? null
  return {
    messageId: normalizeMessageId(mail.messageId),
    inReplyTo: normalizeMessageId(mail.inReplyTo),
    references: normalizeReferences(mail.references),
    from,
    replyTo: addresses(mail.replyTo)[0] ?? null,
    to: addresses(mail.to),
    cc: addresses(mail.cc),
    subject: mail.subject?.trim() || null,
    date: mail.date instanceof Date && !Number.isNaN(mail.date.getTime()) ? mail.date : null,
    text,
    html,
    textFromHtml,
    attachments,
    headers,
    contentType,
    reportType,
  }
}
