import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { detectProvider, MailConfigError, mailConfigFromEnv } from '../../server/mail/config'
import { createMailProvider } from '../../server/mail/provider'
import { DirectoryMailProvider, FakeMailProvider } from '../../server/mail/providers/fake'
import { buildEml, readFixture } from '../fixtures/mail'

const now = new Date('2026-09-27T12:00:00Z')
const listOpts = { limit: 10, bootstrapDays: 1, now }

describe('provider selection', () => {
  it('defaults to fake, honours MAIL_PROVIDER, infers from credentials', () => {
    expect(detectProvider({})).toBe('fake')
    expect(detectProvider({ MAIL_PROVIDER: 'gmail' })).toBe('gmail')
    expect(detectProvider({ MAIL_PROVIDER: 'IMAP' })).toBe('imap')
    expect(detectProvider({ IMAP_HOST: 'imap.example.com' })).toBe('imap')
    expect(
      detectProvider({
        GMAIL_OAUTH_CLIENT_ID: 'id',
        GMAIL_OAUTH_CLIENT_SECRET: 'secret',
        GMAIL_OAUTH_REFRESH_TOKEN: 'token',
      }),
    ).toBe('gmail')
    expect(detectProvider({ GMAIL_SERVICE_ACCOUNT_JSON: '{}' })).toBe('gmail')
    expect(() => detectProvider({ MAIL_PROVIDER: 'exchange' })).toThrow(MailConfigError)
  })

  it('validates the credentials of the selected provider', () => {
    expect(() => mailConfigFromEnv({ MAIL_PROVIDER: 'gmail' })).toThrow(/GMAIL_OAUTH_CLIENT_ID/)
    expect(() =>
      mailConfigFromEnv({
        MAIL_PROVIDER: 'imap',
        IMAP_HOST: 'h',
        IMAP_USER: 'u',
        IMAP_PASSWORD: 'p',
      }),
    ).toThrow(/SMTP_HOST/)
    const imap = mailConfigFromEnv({
      MAIL_PROVIDER: 'imap',
      IMAP_HOST: 'imap.example.com',
      IMAP_USER: 'support@instaradar.app',
      IMAP_PASSWORD: 'pw',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
    })
    expect(imap.imap).toMatchObject({ port: 993, secure: true, sentFolder: null, appendSent: true })
    expect(imap.smtp).toMatchObject({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'support@instaradar.app',
    })
    const fake = mailConfigFromEnv({
      SUPPORT_MAILBOX: 'Support@InstaRadar.app',
      MAIL_FETCH_LIMIT: '7',
    })
    expect(fake).toMatchObject({
      provider: 'fake',
      mailbox: 'support@instaradar.app',
      fetchLimit: 7,
      bootstrapDays: 1,
    })
  })

  it('constructs every adapter without network access', () => {
    expect(createMailProvider(mailConfigFromEnv({}))).toBeInstanceOf(FakeMailProvider)
    expect(createMailProvider(mailConfigFromEnv({ MAIL_FAKE_DIR: '/tmp/x' }))).toBeInstanceOf(
      DirectoryMailProvider,
    )
    const gmail = createMailProvider(
      mailConfigFromEnv({
        MAIL_PROVIDER: 'gmail',
        GMAIL_OAUTH_CLIENT_ID: 'id',
        GMAIL_OAUTH_CLIENT_SECRET: 'secret',
        GMAIL_OAUTH_REFRESH_TOKEN: 'token',
      }),
    )
    expect(gmail.kind).toBe('gmail')
    const imap = createMailProvider(
      mailConfigFromEnv({
        MAIL_PROVIDER: 'imap',
        IMAP_HOST: 'imap.example.com',
        IMAP_USER: 'u',
        IMAP_PASSWORD: 'p',
        SMTP_HOST: 'smtp.example.com',
      }),
    )
    expect(imap.kind).toBe('imap')
  })
})

describe('FakeMailProvider', () => {
  it('lists from a cursor, fetches raw and records sends', async () => {
    const p = new FakeMailProvider()
    p.inject(readFixture('multipart'))
    p.inject(readFixture('french'))
    p.inject(readFixture('attachment'), { threadId: 't-1' })
    const first = await p.listNew(null, { ...listOpts, limit: 2 })
    expect(first.messages.map((m) => m.id)).toEqual(['fake-1', 'fake-2'])
    expect(first.nextCursor.value).toBe('2')
    expect(first.reset).toBe(true)
    const second = await p.listNew(first.nextCursor, listOpts)
    expect(second.messages).toEqual([{ id: 'fake-3', threadId: 't-1' }])
    expect((await p.listNew(second.nextCursor, listOpts)).messages).toEqual([])
    const fetched = await p.fetch({ id: 'fake-2' })
    expect(fetched.raw.toString()).toContain('Message-ID: <french-001@mail.example.fr>')

    const mail = {
      from: { name: 'A', address: 'support@instaradar.app' },
      to: ['x@example.com'],
      subject: 'Hi',
      text: 'body',
      html: '<p>body</p>',
      messageId: '<m1@instaradar.app>',
    }
    p.failNextSend = new Error('smtp down')
    await expect(p.send(mail)).rejects.toThrow('smtp down')
    expect(p.sent).toHaveLength(0)
    const sent = await p.send(mail)
    expect(sent.providerMessageId).toMatch(/^fake-sent-/)
    expect(await p.findSentByRfcMessageId('<m1@instaradar.app>')).toEqual(sent)
    expect(await p.findSentByRfcMessageId('<nope@x>')).toBeNull()
    p.failAfterNextSend = new Error('socket hang up')
    await expect(p.send({ ...mail, messageId: '<m2@instaradar.app>' })).rejects.toThrow(
      'socket hang up',
    )
    expect(p.sent).toHaveLength(2)
  })
})

describe('DirectoryMailProvider', () => {
  const dir = path.resolve(
    import.meta.dirname,
    '../../.data',
    `test-mail-${process.pid}-${Date.now()}`,
  )
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('ingests .eml files by name order and writes sent mail to sent/', async () => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, '001-a.eml'),
      buildEml({ from: 'a@x.y', subject: 'A', messageId: '<a@x>', text: 'a' }),
    )
    writeFileSync(
      path.join(dir, '002-b.eml'),
      buildEml({ from: 'b@x.y', subject: 'B', messageId: '<b@x>', text: 'b' }),
    )
    writeFileSync(path.join(dir, 'notes.txt'), 'ignored')
    const p = new DirectoryMailProvider(dir)
    const first = await p.listNew(null, listOpts)
    expect(first.messages.map((m) => m.id)).toEqual(['001-a.eml', '002-b.eml'])
    expect(first.nextCursor.value).toBe('002-b.eml')
    expect((await p.fetch({ id: '001-a.eml' })).raw.toString()).toContain('Subject: A')
    writeFileSync(
      path.join(dir, '003-c.eml'),
      buildEml({ from: 'c@x.y', subject: 'C', messageId: '<c@x>', text: 'c' }),
    )
    const second = await p.listNew(first.nextCursor, listOpts)
    expect(second.messages.map((m) => m.id)).toEqual(['003-c.eml'])
    const sent = await p.send({
      from: { name: 'A', address: 'support@instaradar.app' },
      to: ['x@example.com'],
      subject: 'Hi',
      text: 'body',
      html: '<p>body</p>',
      messageId: '<dir-1@instaradar.app>',
    })
    expect(sent.providerMessageId).toMatch(/^dir:/)
    expect(await p.findSentByRfcMessageId('<dir-1@instaradar.app>')).toEqual(sent)
    // Sent copies never show up as inbound.
    expect((await p.listNew(second.nextCursor, listOpts)).messages).toEqual([])
  })
})
