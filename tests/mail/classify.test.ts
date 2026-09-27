import { describe, expect, it } from 'vitest'
import { classifyInbound } from '../../server/mail/classify'
import { parseMail } from '../../server/mail/parse'
import { buildEml, readFixture, type FixtureName } from '../fixtures/mail'

const opts = { mailbox: 'support@instaradar.app' }

async function classify(name: FixtureName) {
  return classifyInbound(await parseMail(readFixture(name)), opts)
}

describe('classifyInbound', () => {
  it('keeps customer mail', async () => {
    for (const f of [
      'multipart',
      'html-only',
      'forwarded',
      'french',
      'attachment',
      'reply-plain',
    ] as const) {
      expect(await classify(f), f).toEqual({ kind: 'customer' })
    }
  })

  it('ignores auto-replies (Auto-Submitted, Precedence, subject)', async () => {
    expect(await classify('auto-reply')).toMatchObject({ kind: 'ignore', reason: 'auto_reply' })
    const ooo = await parseMail(
      buildEml({
        from: 'a@example.com',
        subject: 'Out of Office: Re: hello',
        messageId: '<ooo@x>',
        text: 'I am away.',
      }),
    )
    expect(classifyInbound(ooo, opts)).toMatchObject({ kind: 'ignore', reason: 'auto_reply' })
    const explicitNo = await parseMail(
      buildEml({
        from: 'a@example.com',
        subject: 'Question',
        messageId: '<no@x>',
        text: 'Real question.',
        headers: { 'Auto-Submitted': 'no' },
      }),
    )
    expect(classifyInbound(explicitNo, opts)).toEqual({ kind: 'customer' })
  })

  it('ignores bounces (mailer-daemon, delivery-status report, null sender)', async () => {
    expect(await classify('bounce')).toMatchObject({ kind: 'ignore', reason: 'bounce' })
    const postmaster = await parseMail(
      buildEml({
        from: 'postmaster@example.com',
        subject: 'Undeliverable: Re: hi',
        messageId: '<pm@x>',
        text: 'failed',
      }),
    )
    expect(classifyInbound(postmaster, opts)).toMatchObject({ kind: 'ignore', reason: 'bounce' })
  })

  it('ignores our own mail and bulk mail', async () => {
    expect(await classify('own-sent')).toMatchObject({ kind: 'ignore', reason: 'own' })
    expect(await classify('bulk')).toMatchObject({ kind: 'ignore', reason: 'bulk' })
    const other = await parseMail(readFixture('own-sent'))
    expect(classifyInbound(other, { mailbox: 'other@instaradar.app' })).toEqual({
      kind: 'customer',
    })
  })
})
