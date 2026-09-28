import { describe, expect, it } from 'vitest'
import { MAILBOX } from '../../shared/config'
import { textToHtml, withSignature } from '../../server/mail/compose'

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
