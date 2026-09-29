/**
 * Fake providers (IRDR-455). `FakeMailProvider` is in-memory: tests inject raw MIME, read what was
 * sent and make the next call fail. `DirectoryMailProvider` is for the dev server without a real
 * mailbox: drop .eml files into MAIL_FAKE_DIR (names must sort after the ones already seen, e.g. a
 * timestamp prefix) and find sent mail in MAIL_FAKE_DIR/sent.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildMime } from '../compose'
import type {
  FetchedRaw,
  ListNewOptions,
  ListNewResult,
  ListRangeOptions,
  ListRangeResult,
  MailCursor,
  MailProvider,
  OutgoingMail,
  ProviderMessageRef,
  SendResult,
} from '../types'

/** History import over an in-memory list: position + 1 is the UID, so cursors behave like IMAP's. */
function pageOf(
  items: readonly { id: string; threadId?: string | null }[],
  opts: ListRangeOptions,
  uidValidity: string,
): ListRangeResult {
  const sameGeneration = opts.uidValidity == null || opts.uidValidity === uidValidity
  const after = sameGeneration && opts.afterUid != null ? Math.max(0, opts.afterUid) : 0
  const maxUid = items.length
  const page = items.slice(after, after + opts.limit)
  return {
    messages: page.map((m, i) => ({
      id: m.id,
      threadId: m.threadId ?? null,
      folder: opts.folder,
      uid: after + i + 1,
    })),
    uidValidity,
    maxUid,
    lastUid: page.length ? after + page.length : Math.max(after, maxUid),
    reset: !sameGeneration,
  }
}

export interface FakeInboxMessage {
  id: string
  raw: Buffer
  threadId: string | null
}

export interface FakeSentMessage {
  id: string
  mail: OutgoingMail
  raw: Buffer
}

export class FakeMailProvider implements MailProvider {
  readonly kind = 'fake' as const
  readonly inbox: FakeInboxMessage[] = []
  readonly sent: FakeSentMessage[] = []
  private seq = 0
  /** Tests: the next listNew() throws this. */
  failNextList: Error | null = null
  /** Tests: the next send() throws this before storing anything. */
  failNextSend: Error | null = null
  /** Tests: the next send() stores the mail, then throws (network cut after the provider accepted it). */
  failAfterNextSend: Error | null = null

  inject(raw: string | Buffer, opts: { threadId?: string | null } = {}): string {
    const id = `fake-${++this.seq}`
    this.inbox.push({
      id,
      raw: Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8'),
      threadId: opts.threadId ?? null,
    })
    return id
  }

  async listNew(cursor: MailCursor | null, opts: ListNewOptions): Promise<ListNewResult> {
    if (this.failNextList) {
      const e = this.failNextList
      this.failNextList = null
      throw e
    }
    const start = cursor ? Math.min(Math.max(0, Number(cursor.value) || 0), this.inbox.length) : 0
    const slice = this.inbox.slice(start, start + opts.limit)
    return {
      messages: slice.map((m) => ({ id: m.id, threadId: m.threadId })),
      nextCursor: { value: String(start + slice.length) },
      reset: cursor == null,
    }
  }

  /** Tests: a mail we sent before Maelle existed (lands in the fake Sent folder, nothing is delivered). */
  injectSent(raw: string | Buffer, mail: Partial<OutgoingMail> & { messageId: string }): string {
    const id = `fake-sent-${++this.seq}`
    this.sent.push({
      id,
      mail: {
        from: { name: 'InstaRadar Support', address: 'support@instaradar.app' },
        to: [],
        subject: '',
        text: '',
        html: '',
        ...mail,
      },
      raw: Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8'),
    })
    return id
  }

  async listRange(opts: ListRangeOptions): Promise<ListRangeResult> {
    if (this.failNextList) {
      const e = this.failNextList
      this.failNextList = null
      throw e
    }
    return pageOf(opts.folder === 'sent' ? this.sent : this.inbox, opts, `fake-${opts.folder}`)
  }

  async fetch(ref: ProviderMessageRef): Promise<FetchedRaw> {
    const m = this.inbox.find((x) => x.id === ref.id)
    if (m) return { raw: m.raw, threadId: m.threadId }
    const s = this.sent.find((x) => x.id === ref.id)
    if (s) return { raw: s.raw, threadId: s.mail.threadId ?? null }
    throw new Error(`fake provider: unknown message ${ref.id}`)
  }

  async send(mail: OutgoingMail): Promise<SendResult> {
    if (this.failNextSend) {
      const e = this.failNextSend
      this.failNextSend = null
      throw e
    }
    const raw = await buildMime(mail)
    const id = `fake-sent-${++this.seq}`
    this.sent.push({ id, mail, raw })
    if (this.failAfterNextSend) {
      const e = this.failAfterNextSend
      this.failAfterNextSend = null
      throw e
    }
    return { providerMessageId: id, threadId: mail.threadId ?? id }
  }

  async findSentByRfcMessageId(rfcMessageId: string): Promise<SendResult | null> {
    const s = this.sent.find((x) => x.mail.messageId === rfcMessageId)
    return s ? { providerMessageId: s.id, threadId: s.mail.threadId ?? s.id } : null
  }

  async markProcessed(): Promise<void> {}
}

export class DirectoryMailProvider implements MailProvider {
  readonly kind = 'fake' as const
  constructor(readonly dir: string) {}

  private async files(): Promise<string[]> {
    try {
      return (await readdir(this.dir)).filter((f) => f.toLowerCase().endsWith('.eml')).sort()
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
  }

  async listNew(cursor: MailCursor | null, opts: ListNewOptions): Promise<ListNewResult> {
    const files = await this.files()
    const after = cursor?.value ?? ''
    const fresh = files.filter((f) => f > after).slice(0, opts.limit)
    const last = fresh.length ? fresh[fresh.length - 1]! : after
    return {
      messages: fresh.map((f) => ({ id: f })),
      nextCursor: { value: last },
      reset: cursor == null,
    }
  }

  async listRange(opts: ListRangeOptions): Promise<ListRangeResult> {
    const files =
      opts.folder === 'sent' ? (await this.sentFiles()).map((f) => `sent/${f}`) : await this.files()
    return pageOf(
      files.map((id) => ({ id })),
      opts,
      `dir-${opts.folder}`,
    )
  }

  private async sentFiles(): Promise<string[]> {
    try {
      return (await readdir(path.join(this.dir, 'sent')))
        .filter((f) => f.toLowerCase().endsWith('.eml'))
        .sort()
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw e
    }
  }

  async fetch(ref: ProviderMessageRef): Promise<FetchedRaw> {
    const file = ref.id.startsWith('sent/')
      ? path.join(this.dir, 'sent', path.basename(ref.id))
      : path.join(this.dir, path.basename(ref.id))
    return { raw: await readFile(file), threadId: null }
  }

  async send(mail: OutgoingMail): Promise<SendResult> {
    const raw = await buildMime(mail)
    const sentDir = path.join(this.dir, 'sent')
    await mkdir(sentDir, { recursive: true })
    const name = `${Date.now()}-${mail.messageId.replace(/[^\w.-]+/g, '_')}.eml`
    await writeFile(path.join(sentDir, name), raw)
    return { providerMessageId: `dir:${name}`, threadId: mail.threadId ?? null }
  }

  async findSentByRfcMessageId(rfcMessageId: string): Promise<SendResult | null> {
    const sentDir = path.join(this.dir, 'sent')
    let names: string[]
    try {
      names = await readdir(sentDir)
    } catch {
      return null
    }
    for (const name of names) {
      const raw = await readFile(path.join(sentDir, name), 'utf8')
      if (raw.includes(`Message-ID: ${rfcMessageId}`)) {
        return { providerMessageId: `dir:${name}`, threadId: null }
      }
    }
    return null
  }

  async markProcessed(): Promise<void> {}
}
