/**
 * Outgoing MIME (IRDR-455): plain text plus simple HTML, threading headers, attachments. Built with
 * nodemailer's MailComposer so Gmail (raw), SMTP (raw) and the IMAP Sent folder get the same bytes.
 */
import { randomUUID } from 'node:crypto'
import MailComposer from 'nodemailer/lib/mail-composer'
import { MAILBOX } from '#shared/config'
import { SIGNATURE_PHOTO_JPEG_BASE64 } from './signature-photo'
import type { OutgoingAttachment, OutgoingMail } from './types'

/**
 * The text that goes out for a reply: the draft body, then the standard "-- " separator (mail
 * clients collapse what follows it) and Anastasia's signature from shared/config.ts.
 */
export function withSignature(body: string): string {
  return `${body.replace(/\s+$/, '')}\n\n-- \n${MAILBOX.signature}\n`
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function paragraphsHtml(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
}

function htmlDocument(inner: string): string {
  return `<!doctype html><html><body style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.5; color: #222;">${inner}</body></html>`
}

/** Paragraphs separated by blank lines become <p>, single newlines become <br>. No styling games. */
export function textToHtml(text: string): string {
  return htmlDocument(paragraphsHtml(text).join('\n'))
}

/** Content-ID of Anastasia's photo, referenced as `cid:` from the HTML signature. */
export const SIGNATURE_PHOTO_CID = 'anastasia-photo@instaradar.app'

/** The photo as an inline attachment; every reply whose HTML comes from replyHtml carries it. */
export function signaturePhotoAttachment(): OutgoingAttachment {
  return {
    filename: 'anastasia.jpg',
    content: Buffer.from(SIGNATURE_PHOTO_JPEG_BASE64, 'base64'),
    contentType: 'image/jpeg',
    cid: SIGNATURE_PHOTO_CID,
  }
}

/**
 * The HTML part of a reply: the draft body as paragraphs, then the signature from shared/config.ts
 * with Anastasia's photo next to her name. The text part stays withSignature(body).
 */
export function replyHtml(body: string): string {
  const signature = paragraphsHtml(MAILBOX.signature)
  const photo = `<img src="cid:${SIGNATURE_PHOTO_CID}" width="64" height="64" alt="Anastasia" style="display: block; width: 64px; height: 64px; border-radius: 50%;">`
  const block = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top: 8px;"><tr><td style="vertical-align: top; padding: 14px 14px 0 0;">${photo}</td><td style="vertical-align: top;">${signature.join('\n')}</td></tr></table>`
  return htmlDocument(`${paragraphsHtml(body).join('\n')}\n${block}`)
}

const REPLY_PREFIX = /^\s*(re|aw|antw|sv|vs|r)\s*(\[\d+\])?\s*:/i

export function replySubject(subject: string): string {
  const s = subject.replace(/\s+/g, ' ').trim()
  if (!s) return 'Re: your message'
  return REPLY_PREFIX.test(s) ? s : `Re: ${s}`
}

export function newMessageId(domain: string): string {
  return `<${randomUUID()}@${domain}>`
}

export async function buildMime(mail: OutgoingMail): Promise<Buffer> {
  const composer = new MailComposer({
    from: mail.from,
    to: mail.to,
    cc: mail.cc && mail.cc.length ? mail.cc : undefined,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo ?? undefined,
    references: mail.references && mail.references.length ? mail.references.join(' ') : undefined,
    date: mail.date ?? new Date(),
    attachments: (mail.attachments ?? []).map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
      ...(a.cid ? { cid: a.cid, contentDisposition: 'inline' as const } : {}),
    })),
    disableFileAccess: true,
    disableUrlAccess: true,
  })
  return composer.compile().build()
}
