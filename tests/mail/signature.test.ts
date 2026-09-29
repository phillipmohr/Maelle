import { describe, expect, it } from 'vitest'
import { MAILBOX } from '../../shared/config'
import {
  buildMime,
  replyHtml,
  SIGNATURE_PHOTO_CID,
  signaturePhotoAttachment,
  textToHtml,
  withSignature,
} from '../../server/mail/compose'

describe('withSignature', () => {
  it('appends the standard separator and the signature from shared/config.ts', () => {
    const text = withSignature('Hi Tom,\n\nAll set.\n\n')
    expect(text).toBe(`Hi Tom,\n\nAll set.\n\n-- \n${MAILBOX.signature}\n`)
    expect(text).toContain('Anastasia\nCustomer Care · InstaRadar\nsupport@instaradar.app')
    expect(text).not.toMatch(/—/)
  })

  it('renders the signature as its own paragraphs in the HTML part', () => {
    const html = textToHtml(withSignature('All set.'))
    expect(html).toContain('<p>All set.</p>')
    expect(html).toContain('Anastasia<br>Customer Care · InstaRadar<br>support@instaradar.app')
    expect(html).toContain('I genuinely care that every customer leaves happy')
  })
})

describe('replyHtml', () => {
  it("puts Anastasia's photo next to the signature as an inline cid image", async () => {
    const html = replyHtml('All set.')
    expect(html).toContain('<p>All set.</p>')
    expect(html).toContain(`src="cid:${SIGNATURE_PHOTO_CID}"`)
    expect(html).toContain('Anastasia<br>Customer Care · InstaRadar<br>support@instaradar.app')

    const photo = signaturePhotoAttachment()
    expect(photo.cid).toBe(SIGNATURE_PHOTO_CID)
    expect(photo.content.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    const mime = (
      await buildMime({
        from: { name: MAILBOX.fromName, address: MAILBOX.address },
        to: ['tom@example.com'],
        subject: 'Re: x',
        text: withSignature('All set.'),
        html,
        messageId: '<a@instaradar.app>',
        attachments: [photo],
      })
    ).toString()
    expect(mime).toContain('multipart/related')
    expect(mime).toContain(`Content-ID: <${SIGNATURE_PHOTO_CID}>`)
    expect(mime).toContain('From: Anastasia at InstaRadar <support@instaradar.app>')
  })
})
