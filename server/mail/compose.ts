/**
 * Outgoing MIME (IRDR-455): plain text plus simple HTML, threading headers, attachments. Built with
 * nodemailer's MailComposer so Gmail (raw), SMTP (raw) and the IMAP Sent folder get the same bytes.
 */
import { randomUUID } from 'node:crypto'
import MailComposer from 'nodemailer/lib/mail-composer'
import type { OutgoingMail } from './types'

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Paragraphs separated by blank lines become <p>, single newlines become <br>. No styling games. */
export function textToHtml(text: string): string {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
  return `<!doctype html><html><body style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; font-size: 15px; line-height: 1.5; color: #222;">${paragraphs.join('\n')}</body></html>`
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
    })),
    disableFileAccess: true,
    disableUrlAccess: true,
  })
  return composer.compile().build()
}
