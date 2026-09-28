/**
 * IMAP + SMTP provider (IRDR-455) for a mailbox that is not on Google Workspace. Cursor: the last
 * seen INBOX UID together with the mailbox UIDVALIDITY; a changed UIDVALIDITY triggers a full sync
 * of the last MAILBOX.bootstrapDays. Sending goes through SMTP and the same bytes are appended to the
 * Sent folder (found via the \Sent special-use flag, or the configured sentFolder).
 */
import { ImapFlow } from 'imapflow'
import { createTransport, type Transporter } from 'nodemailer'
import type { ImapConfig, SmtpConfig } from '../config'
import { buildMime } from '../compose'
import type {
  FetchedRaw,
  ListNewOptions,
  ListNewResult,
  MailCursor,
  MailProvider,
  OutgoingMail,
  ProviderMessageRef,
  SendResult,
} from '../types'

const SENT_FOLDER_NAMES = [
  'Sent',
  'Sent Items',
  'Sent Messages',
  'Sent Mail',
  'INBOX.Sent',
  'INBOX/Sent',
]
const DAY_MS = 24 * 60 * 60 * 1000

export class ImapSmtpProvider implements MailProvider {
  readonly kind = 'imap' as const
  /** Raw sources fetched together with the listing, so fetch() needs no second connection. Emptied on every listing and as each message is fetched. */
  private readonly cache = new Map<string, FetchedRaw>()
  private transporter: Transporter | null = null

  constructor(
    private readonly imap: ImapConfig,
    private readonly smtp: SmtpConfig,
    readonly mailbox: string,
  ) {}

  private async withClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host: this.imap.host,
      port: this.imap.port,
      secure: this.imap.secure,
      auth: { user: this.imap.user, pass: this.imap.password },
      logger: false,
      connectionTimeout: 30_000,
      greetingTimeout: 30_000,
      socketTimeout: 120_000,
    })
    await client.connect()
    try {
      return await fn(client)
    } finally {
      await client.logout().catch(() => client.close())
    }
  }

  async listNew(cursor: MailCursor | null, opts: ListNewOptions): Promise<ListNewResult> {
    this.cache.clear()
    return this.withClient(async (client) => {
      const lock = await client.getMailboxLock('INBOX')
      try {
        const box = client.mailbox
        if (!box) throw new Error('imap: INBOX could not be opened')
        const uidValidity = String(box.uidValidity)
        const sameGeneration = cursor != null && cursor.meta?.uidValidity === uidValidity
        const lastUid = sameGeneration ? Number(cursor!.value) || 0 : null
        let uids: number[]
        if (lastUid != null) {
          // `n:*` also returns the last message when its UID is below n; filter it out.
          const found = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true })
          uids = (Array.isArray(found) ? found : []).filter((u) => u > lastUid)
        } else {
          const since = new Date(opts.now.getTime() - Math.max(1, opts.bootstrapDays) * DAY_MS)
          const found = await client.search({ since }, { uid: true })
          uids = Array.isArray(found) ? found : []
        }
        uids.sort((a, b) => a - b)
        const batch = uids.slice(0, opts.limit)
        const messages: ProviderMessageRef[] = []
        if (batch.length) {
          for await (const msg of client.fetch(
            batch,
            { uid: true, source: true, threadId: true },
            { uid: true },
          )) {
            const id = `${uidValidity}:${msg.uid}`
            if (msg.source) this.cache.set(id, { raw: msg.source, threadId: msg.threadId ?? null })
            messages.push({ id, threadId: msg.threadId ?? null })
          }
        }
        const maxUid = batch.length
          ? batch[batch.length - 1]!
          : lastUid != null
            ? lastUid
            : Math.max(0, box.uidNext - 1)
        return {
          messages,
          nextCursor: { value: String(maxUid), meta: { uidValidity } },
          reset: lastUid == null,
        }
      } finally {
        lock.release()
      }
    })
  }

  async fetch(ref: ProviderMessageRef): Promise<FetchedRaw> {
    const cached = this.cache.get(ref.id)
    if (cached) {
      this.cache.delete(ref.id)
      return cached
    }
    const uid = Number(ref.id.split(':')[1])
    if (!Number.isFinite(uid)) throw new Error(`imap: bad message ref ${ref.id}`)
    return this.withClient(async (client) => {
      const lock = await client.getMailboxLock('INBOX')
      try {
        const msg = await client.fetchOne(
          String(uid),
          { uid: true, source: true, threadId: true },
          { uid: true },
        )
        if (!msg || !msg.source) throw new Error(`imap: message ${ref.id} not found`)
        return { raw: msg.source, threadId: msg.threadId ?? null }
      } finally {
        lock.release()
      }
    })
  }

  private transport(): Transporter {
    if (!this.transporter) {
      this.transporter = createTransport({
        host: this.smtp.host,
        port: this.smtp.port,
        secure: this.smtp.secure,
        auth:
          this.smtp.user && this.smtp.password
            ? { user: this.smtp.user, pass: this.smtp.password }
            : undefined,
      })
    }
    return this.transporter
  }

  private async sentFolder(client: ImapFlow): Promise<string> {
    if (this.imap.sentFolder) return this.imap.sentFolder
    const list = await client.list()
    const special = list.find((m) => m.specialUse === '\\Sent')
    if (special) return special.path
    const byName = list.find((m) => SENT_FOLDER_NAMES.includes(m.path))
    return byName?.path ?? 'Sent'
  }

  async send(mail: OutgoingMail): Promise<SendResult> {
    const raw = await buildMime(mail)
    const info = await this.transport().sendMail({
      envelope: { from: mail.from.address, to: [...mail.to, ...(mail.cc ?? [])] },
      raw,
    })
    let providerMessageId = `smtp:${info.messageId || mail.messageId}`
    if (this.imap.appendSent) {
      const appended = await this.withClient(async (client) =>
        client.append(await this.sentFolder(client), raw, ['\\Seen'], new Date()),
      )
      if (appended && appended.uid != null) {
        providerMessageId = `${appended.uidValidity ?? 'sent'}:${appended.uid}`
      }
    }
    return { providerMessageId, threadId: null }
  }

  async findSentByRfcMessageId(rfcMessageId: string): Promise<SendResult | null> {
    return this.withClient(async (client) => {
      const folders = [await this.sentFolder(client), 'INBOX']
      for (const folder of folders) {
        const lock = await client.getMailboxLock(folder).catch(() => null)
        if (!lock) continue
        try {
          const found = await client.search(
            { header: { 'message-id': rfcMessageId } },
            { uid: true },
          )
          const uid = Array.isArray(found) && found.length ? found[found.length - 1]! : null
          if (uid != null) {
            const validity = client.mailbox ? String(client.mailbox.uidValidity) : folder
            return { providerMessageId: `${validity}:${uid}`, threadId: null }
          }
        } finally {
          lock.release()
        }
      }
      return null
    })
  }

  async markProcessed(ref: ProviderMessageRef): Promise<void> {
    const uid = Number(ref.id.split(':')[1])
    if (!Number.isFinite(uid)) return
    await this.withClient(async (client) => {
      const lock = await client.getMailboxLock('INBOX')
      try {
        await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
      } finally {
        lock.release()
      }
    })
  }
}
