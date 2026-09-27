import { describe, expect, it } from 'vitest'
import {
  normalizeMessageId,
  normalizeReferences,
  parseMail,
  syntheticMessageId,
} from '../../server/mail/parse'
import { buildEml, readFixture } from '../fixtures/mail'

describe('parseMail', () => {
  it('multipart: text and html parts, addresses, ids and date', async () => {
    const m = await parseMail(readFixture('multipart'))
    expect(m.messageId).toBe('<multipart-001@mail.example.com>')
    expect(m.from).toEqual({ address: 'tom.becker@example.com', name: 'Tom Becker' })
    expect(m.to[0]?.address).toBe('support@instaradar.app')
    expect(m.subject).toBe('Please cancel my subscription')
    expect(m.text).toContain('I’d like to cancel my subscription at the end of the current period.')
    expect(m.html).toContain('<div dir="ltr">')
    expect(m.textFromHtml).toBe(false)
    expect(m.date?.toISOString()).toBe('2026-09-27T07:12:00.000Z')
    expect(m.attachments).toHaveLength(0)
    expect(m.contentType).toBe('multipart/alternative')
  })

  it('html only: text is derived from the html with quotes marked, threading headers kept', async () => {
    const m = await parseMail(readFixture('html-only'))
    expect(m.textFromHtml).toBe(true)
    expect(m.text).toContain('Yes, please go ahead & refund the payment.')
    expect(m.text).toContain('> Hi Priya, thanks for reaching out!')
    expect(m.inReplyTo).toBe('<reply-from-support-77@instaradar.app>')
    expect(m.references).toEqual([
      '<original-77@mail.example.com>',
      '<reply-from-support-77@instaradar.app>',
    ])
  })

  it('forwarded: keeps the forwarded receipt in the text', async () => {
    const m = await parseMail(readFixture('forwarded'))
    expect(m.subject).toBe('Fwd: Your InstaRadar receipt')
    expect(m.text).toContain('Receipt #2041-8831')
    expect(m.text).toContain('Amount paid: $13.07')
  })

  it('non-English: decodes encoded words and quoted-printable accents', async () => {
    const m = await parseMail(readFixture('french'))
    expect(m.subject).toBe("Problème d'accès à mon compte")
    expect(m.from?.name).toBe('Élodie Martin')
    expect(m.text).toContain('accéder à mon compte')
    expect(m.text).toContain('facturée le 25 septembre')
    expect(m.text).toContain('Élodie')
  })

  it('auto-reply: exposes the headers the classifier needs', async () => {
    const m = await parseMail(readFixture('auto-reply'))
    expect(m.headers['auto-submitted']).toBe('auto-replied')
    expect(m.headers.precedence).toBe('auto_reply')
    expect(m.headers['x-auto-response-suppress']).toBe('All')
  })

  it('bounce: multipart/report with delivery-status and the null sender', async () => {
    const m = await parseMail(readFixture('bounce'))
    expect(m.contentType).toBe('multipart/report')
    expect(m.reportType).toBe('delivery-status')
    expect(m.from?.address).toBe('mailer-daemon@googlemail.com')
    expect(m.headers['return-path']).toBe('<>')
    expect(m.references).toEqual(['<reply-from-support-4809@instaradar.app>'])
  })

  it('attachment: decodes the png with name, type and size', async () => {
    const m = await parseMail(readFixture('attachment'))
    expect(m.attachments).toHaveLength(1)
    const a = m.attachments[0]!
    expect(a.filename).toBe('screenshot.png')
    expect(a.contentType).toBe('image/png')
    expect(a.content.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(a.size).toBe(a.content.length)
    expect(a.inline).toBe(false)
    expect(m.text).toContain('Screenshot attached')
  })

  it('normalises message ids and references', () => {
    expect(normalizeMessageId(' abc@x.y ')).toBe('<abc@x.y>')
    expect(normalizeMessageId('<abc@x.y>')).toBe('<abc@x.y>')
    expect(normalizeMessageId('')).toBeNull()
    expect(normalizeReferences('<a@x> b@x <a@x>')).toEqual(['<a@x>', '<b@x>'])
    expect(normalizeReferences(['<a@x>', '<c@x>'])).toEqual(['<a@x>', '<c@x>'])
  })

  it('mail without a Message-ID gets a deterministic synthetic one', async () => {
    const raw = buildEml({
      from: 'x@example.com',
      subject: 'no id',
      messageId: '',
      text: 'hello',
    })
      .toString('utf8')
      .replace(/Message-ID: \r\n/, '')
    const m = await parseMail(raw)
    expect(m.messageId).toBeNull()
    expect(syntheticMessageId(raw)).toBe(syntheticMessageId(raw))
    expect(syntheticMessageId(raw)).toMatch(/^<[0-9a-f]{40}@missing-message-id\.maelle\.local>$/)
  })
})
