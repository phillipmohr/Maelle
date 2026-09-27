import { describe, expect, it } from 'vitest'
import { parseMail } from '../../server/mail/parse'
import { decodeEntities, htmlToText, stripQuotedText } from '../../server/mail/quote'
import { readFixture } from '../fixtures/mail'

describe('stripQuotedText', () => {
  it('cuts a wrapped Gmail "On ... wrote:" header and the quoted block', async () => {
    const m = await parseMail(readFixture('reply-plain'))
    expect(stripQuotedText(m.text!)).toBe(
      'Thanks Anastasia. Mostly the price, I only needed it for one project.\n\nTom',
    )
  })

  it('handles html-only mail via the converted text', async () => {
    const m = await parseMail(readFixture('html-only'))
    const stripped = stripQuotedText(m.text!)
    expect(stripped).toContain('Yes, please go ahead & refund the payment.')
    expect(stripped).toContain('Priya')
    expect(stripped).not.toContain('thanks for reaching out')
    expect(stripped).not.toContain('wrote:')
  })

  it('keeps forwarded content', async () => {
    const m = await parseMail(readFixture('forwarded'))
    const stripped = stripQuotedText(m.text!)
    expect(stripped).toContain('Receipt #2041-8831')
    expect(stripped).toContain('From: Stripe <receipts@stripe.com>')
  })

  it('cuts German, French and Outlook style headers', () => {
    expect(
      stripQuotedText(
        'Danke!\n\nAm 27.09.2026 um 10:00 schrieb Anastasia <support@instaradar.app>:\n> Hallo',
      ),
    ).toBe('Danke!')
    expect(
      stripQuotedText('Merci.\n\nLe 27 sept. 2026 à 10:00, Anastasia <s@x.y> a écrit :\n> Bonjour'),
    ).toBe('Merci.')
    expect(
      stripQuotedText(
        'Thanks, will do.\n\n________________________________\nFrom: Anastasia <support@instaradar.app>\nSent: Sunday, September 27, 2026 2:00 PM\nTo: Tom\nSubject: Re: Please cancel\n\nHi Tom',
      ),
    ).toBe('Thanks, will do.')
    expect(
      stripQuotedText(
        'Sure.\n\nFrom: Anastasia <support@instaradar.app>\nSent: Sunday\nSubject: Re: x\n\nold text',
      ),
    ).toBe('Sure.')
    // A lone "From:" line in the customer's own words is not a header block.
    expect(stripQuotedText('From: my point of view this is wrong.\n\nPlease check.')).toBe(
      'From: my point of view this is wrong.\n\nPlease check.',
    )
    expect(stripQuotedText('-----Original Message-----\nFrom: x\n\nold')).toBe(
      '-----Original Message-----\nFrom: x\n\nold',
    )
  })

  it('falls back to the full text when everything is quoted', () => {
    expect(stripQuotedText('> only quoted\n> lines')).toBe('> only quoted\n> lines')
  })
})

describe('htmlToText', () => {
  it('turns blocks into lines and blockquotes into quoted lines', () => {
    expect(htmlToText('<p>Hello</p><blockquote><p>Old</p></blockquote>')).toBe('Hello\n\n> Old')
    expect(htmlToText('<div>a<br>b</div><div>c</div>')).toBe('a\nb\nc')
    expect(htmlToText('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two')
  })

  it('decodes entities, drops scripts and styles, keeps link targets', () => {
    expect(htmlToText('<style>p{}</style><p>Tom &amp; Jerry &lt;3 &#233;t&#xE9; &nbsp;x</p>')).toBe(
      'Tom & Jerry <3 été x',
    )
    expect(htmlToText('<a href="https://x.y/p">Click</a> <a href="https://z">https://z</a>')).toBe(
      'Click (https://x.y/p) https://z',
    )
    expect(decodeEntities('&quot;q&quot; &rsquo;')).toBe('"q" ’')
  })

  it('nests quotes with a second marker', () => {
    expect(htmlToText('<blockquote>a<blockquote>b</blockquote></blockquote>')).toBe('> a\n>> b')
  })
})
