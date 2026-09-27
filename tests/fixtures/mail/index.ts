/** .eml fixtures for the mail pipeline tests (IRDR-455) and a builder for ad-hoc messages. */
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const FIXTURE_DIR = path.resolve(import.meta.dirname)

export const FIXTURES = [
  'multipart',
  'html-only',
  'forwarded',
  'french',
  'auto-reply',
  'bounce',
  'attachment',
  'own-sent',
  'bulk',
  'reply-plain',
] as const
export type FixtureName = (typeof FIXTURES)[number]

export function readFixture(name: FixtureName): Buffer {
  return readFileSync(path.join(FIXTURE_DIR, `${name}.eml`))
}

export interface EmlSpec {
  from: string
  to?: string
  subject: string
  messageId: string
  inReplyTo?: string
  references?: string[]
  date?: Date
  text: string
  html?: string
  headers?: Record<string, string>
}

let seq = 0
export function uniqueMessageId(tag = 'test'): string {
  seq++
  return `<${tag}-${Date.now()}-${seq}-${Math.random().toString(36).slice(2, 8)}@mail.example.com>`
}

/** A plain-text (or text + HTML) RFC 5322 message with CRLF line endings. */
export function buildEml(spec: EmlSpec): Buffer {
  const lines: string[] = [
    `Date: ${(spec.date ?? new Date()).toUTCString()}`,
    `From: ${spec.from}`,
    `To: ${spec.to ?? 'support@instaradar.app'}`,
    `Subject: ${spec.subject}`,
    `Message-ID: ${spec.messageId}`,
  ]
  if (spec.inReplyTo) lines.push(`In-Reply-To: ${spec.inReplyTo}`)
  if (spec.references?.length) lines.push(`References: ${spec.references.join(' ')}`)
  for (const [k, v] of Object.entries(spec.headers ?? {})) lines.push(`${k}: ${v}`)
  lines.push('MIME-Version: 1.0')
  if (spec.html) {
    lines.push('Content-Type: multipart/alternative; boundary="alt"', '', '--alt')
    lines.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit', '')
    lines.push(spec.text, '--alt')
    lines.push('Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit', '')
    lines.push(spec.html, '--alt--', '')
  } else {
    lines.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit', '')
    lines.push(spec.text, '')
  }
  return Buffer.from(lines.join('\r\n'), 'utf8')
}
