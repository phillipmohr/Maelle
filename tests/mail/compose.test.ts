import { describe, expect, it } from 'vitest'
import { buildMime, newMessageId, replySubject, textToHtml } from '../../server/mail/compose'
import { parseMail } from '../../server/mail/parse'

describe('compose', () => {
  it('builds a threaded reply with text, html and an attachment', async () => {
    const messageId = newMessageId('instaradar.app')
    const raw = await buildMime({
      from: { name: 'Anastasia (InstaRadar Support)', address: 'support@instaradar.app' },
      to: ['tom.becker@example.com'],
      subject: 'Re: Please cancel my subscription',
      text: 'Hi, thanks for reaching out!\n\nDone.\n\nBest regards,\nAnastasia',
      html: textToHtml('Hi, thanks for reaching out!\n\nDone.\n\nBest regards,\nAnastasia'),
      messageId,
      inReplyTo: '<multipart-001@mail.example.com>',
      references: ['<first@mail.example.com>', '<multipart-001@mail.example.com>'],
      attachments: [
        {
          filename: 'refund.pdf',
          content: Buffer.from('%PDF-1.4 fake'),
          contentType: 'application/pdf',
        },
      ],
      date: new Date('2026-09-27T12:00:00Z'),
    })
    const m = await parseMail(raw)
    expect(m.messageId).toBe(messageId)
    expect(m.inReplyTo).toBe('<multipart-001@mail.example.com>')
    expect(m.references).toEqual(['<first@mail.example.com>', '<multipart-001@mail.example.com>'])
    expect(m.subject).toBe('Re: Please cancel my subscription')
    expect(m.from).toEqual({
      address: 'support@instaradar.app',
      name: 'Anastasia (InstaRadar Support)',
    })
    expect(m.to[0]?.address).toBe('tom.becker@example.com')
    expect(m.text).toContain('Hi, thanks for reaching out!')
    expect(m.html).toContain('<p>Hi, thanks for reaching out!</p>')
    expect(m.attachments).toHaveLength(1)
    expect(m.attachments[0]?.filename).toBe('refund.pdf')
    expect(m.attachments[0]?.content.toString()).toBe('%PDF-1.4 fake')
    expect(m.date?.toISOString()).toBe('2026-09-27T12:00:00.000Z')
  })

  it('formats subjects and html safely', () => {
    expect(replySubject('Cancel')).toBe('Re: Cancel')
    expect(replySubject('Re: Cancel')).toBe('Re: Cancel')
    expect(replySubject('re: cancel')).toBe('re: cancel')
    expect(replySubject('AW: Kündigung')).toBe('AW: Kündigung')
    expect(replySubject('   ')).toBe('Re: your message')
    const html = textToHtml('Line 1\nLine 2\n\n<b>not bold</b> & co')
    expect(html).toContain('<p>Line 1<br>Line 2</p>')
    expect(html).toContain('<p>&lt;b&gt;not bold&lt;/b&gt; &amp; co</p>')
    expect(newMessageId('instaradar.app')).toMatch(/^<[0-9a-f-]{36}@instaradar\.app>$/)
  })
})
