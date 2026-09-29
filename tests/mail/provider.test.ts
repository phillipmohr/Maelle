import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { detectProvider, mailConfigFromEnv } from '../../server/mail/config'
import { createMailProvider } from '../../server/mail/provider'
import { DirectoryMailProvider, FakeMailProvider } from '../../server/mail/providers/fake'
import { buildEml, readFixture } from '../fixtures/mail'

const now = new Date('2026-09-27T12:00:00Z')
const listOpts = { limit: 10, bootstrapDays: 1, now }

describe('provider selection', () => {
  it('uses the mailbox when its password is set and the fake otherwise', () => {
    expect(detectProvider({})).toBe('fake')
    expect(detectProvider({ MAIL_PASSWORD: '   ' })).toBe('fake')
    expect(detectProvider({ MAIL_PASSWORD: 'pw' })).toBe('imap')
  })

  it('fixes the mailbox, its hosts and the knobs in code; only the password comes from the environment', () => {
    const imap = mailConfigFromEnv({ MAIL_PASSWORD: 'pw' })
    expect(imap.provider).toBe('imap')
    expect(imap.mailbox).toBe('support@instaradar.app')
    expect(imap.fromName).toBe('Anastasia at InstaRadar')
    expect(imap.imap).toEqual({
      host: 'mail.privateemail.com',
      port: 993,
      secure: true,
      user: 'support@instaradar.app',
      password: 'pw',
      sentFolder: null,
      appendSent: true,
    })
    expect(imap.smtp).toEqual({
      host: 'mail.privateemail.com',
      port: 465,
      secure: true,
      user: 'support@instaradar.app',
      password: 'pw',
    })
    const fake = mailConfigFromEnv({})
    expect(fake).toMatchObject({
      provider: 'fake',
      mailbox: 'support@instaradar.app',
      notifyEmail: 'phillip.mohr97@gmail.com',
      fetchLimit: 50,
      bootstrapDays: 1,
      stuckSendMinutes: 5,
      imap: null,
      smtp: null,
    })
  })

  it('constructs every adapter without network access', () => {
    expect(createMailProvider(mailConfigFromEnv({}))).toBeInstanceOf(FakeMailProvider)
    expect(createMailProvider(mailConfigFromEnv({ MAIL_FAKE_DIR: '/tmp/x' }))).toBeInstanceOf(
      DirectoryMailProvider,
    )
    expect(createMailProvider(mailConfigFromEnv({ MAIL_PASSWORD: 'p' })).kind).toBe('imap')
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

describe('history import listing (fake)', () => {
  it('pages a folder by position, resumes after a cursor and restarts on a new generation', async () => {
    const p = new FakeMailProvider()
    for (let i = 0; i < 5; i++) {
      p.inject(
        buildEml({
          from: 'a@example.com',
          subject: `m${i}`,
          messageId: `<m${i}@example.com>`,
          text: 'x',
        }),
      )
    }
    const first = await p.listRange({
      folder: 'inbox',
      afterUid: null,
      uidValidity: null,
      limit: 2,
    })
    expect(first).toMatchObject({ uidValidity: 'fake-inbox', maxUid: 5, lastUid: 2, reset: false })
    expect(first.messages.map((m) => [m.uid, m.folder])).toEqual([
      [1, 'inbox'],
      [2, 'inbox'],
    ])
    const second = await p.listRange({
      folder: 'inbox',
      afterUid: first.lastUid,
      uidValidity: first.uidValidity,
      limit: 10,
    })
    expect(second.messages.map((m) => m.uid)).toEqual([3, 4, 5])
    expect(second.lastUid).toBe(5)
    const end = await p.listRange({
      folder: 'inbox',
      afterUid: 5,
      uidValidity: 'fake-inbox',
      limit: 10,
    })
    expect(end).toMatchObject({ messages: [], lastUid: 5, maxUid: 5 })
    // The cursor belongs to another generation: start over.
    const again = await p.listRange({ folder: 'inbox', afterUid: 5, uidValidity: 'old', limit: 10 })
    expect(again.reset).toBe(true)
    expect(again.messages).toHaveLength(5)
    // The Sent folder is empty until something was sent.
    expect(
      await p.listRange({ folder: 'sent', afterUid: null, uidValidity: null, limit: 5 }),
    ).toMatchObject({
      messages: [],
      maxUid: 0,
      lastUid: 0,
    })
    expect(await p.fetch(first.messages[0]!)).toMatchObject({ threadId: null })
  })
})
