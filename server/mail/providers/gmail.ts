/**
 * Gmail API provider (IRDR-455). Cursor: the mailbox historyId. `users.history.list` returns every
 * message added to INBOX since the cursor; an expired historyId (HTTP 404) triggers a full sync of
 * the last MAIL_BOOTSTRAP_DAYS. Sending through `users.messages.send` with the inbound threadId
 * puts the reply in the same Gmail thread and the mailbox's Sent folder.
 *
 * Auth: OAuth client + refresh token of the mailbox, or a service account with domain-wide
 * delegation impersonating GMAIL_IMPERSONATE_USER (Google Workspace).
 */
import { gmail as createGmailApi, type gmail_v1 } from '@googleapis/gmail'
import { JWT, OAuth2Client } from 'google-auth-library'
import type { GmailConfig } from '../config'
import { MailConfigError } from '../config'
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

/** Read, modify labels and send. */
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.modify']
/** Upper bound for a full sync; the bootstrap window is a day or two, so this is never reached in practice. */
export const BOOTSTRAP_MAX_MESSAGES = 5_000

export function createGmailAuth(cfg: GmailConfig, mailbox: string): OAuth2Client {
  if (cfg.serviceAccountJson) {
    let sa: { client_email?: string; private_key?: string }
    try {
      sa = JSON.parse(cfg.serviceAccountJson)
    } catch {
      throw new MailConfigError('GMAIL_SERVICE_ACCOUNT_JSON is not valid JSON')
    }
    if (!sa.client_email || !sa.private_key) {
      throw new MailConfigError('GMAIL_SERVICE_ACCOUNT_JSON needs client_email and private_key')
    }
    return new JWT({
      email: sa.client_email,
      key: sa.private_key,
      scopes: GMAIL_SCOPES,
      subject: cfg.impersonateUser ?? mailbox,
    })
  }
  const client = new OAuth2Client({
    clientId: cfg.clientId ?? undefined,
    clientSecret: cfg.clientSecret ?? undefined,
  })
  client.setCredentials({ refresh_token: cfg.refreshToken })
  return client
}

function httpStatus(e: unknown): number | null {
  const err = e as { code?: unknown; status?: unknown; response?: { status?: unknown } }
  for (const v of [err?.code, err?.status, err?.response?.status]) {
    const n = Number(v)
    if (Number.isFinite(n) && n >= 100 && n < 600) return n
  }
  return null
}

export class GmailProvider implements MailProvider {
  readonly kind = 'gmail' as const
  private readonly api: gmail_v1.Gmail

  constructor(cfg: GmailConfig, mailbox: string, api?: gmail_v1.Gmail) {
    this.api =
      api ??
      createGmailApi({
        version: 'v1',
        auth: createGmailAuth(cfg, mailbox) as unknown as gmail_v1.Options['auth'],
      })
  }

  async listNew(cursor: MailCursor | null, opts: ListNewOptions): Promise<ListNewResult> {
    if (cursor?.value) {
      try {
        return await this.listHistory(cursor.value)
      } catch (e) {
        // 404: the history id is too old. Full sync from the bootstrap window; dedupe makes it safe.
        if (httpStatus(e) !== 404) throw e
      }
    }
    return this.bootstrap(opts)
  }

  private async listHistory(startHistoryId: string): Promise<ListNewResult> {
    const ids = new Map<string, string | null>()
    let latest = startHistoryId
    let pageToken: string | undefined
    do {
      const res = await this.api.users.history.list({
        userId: 'me',
        startHistoryId,
        historyTypes: ['messageAdded'],
        labelId: 'INBOX',
        maxResults: 500,
        pageToken,
      })
      for (const h of res.data.history ?? []) {
        for (const added of h.messagesAdded ?? []) {
          const m = added.message
          if (m?.id && !ids.has(m.id)) ids.set(m.id, m.threadId ?? null)
        }
      }
      if (res.data.historyId) latest = res.data.historyId
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken)
    return {
      messages: [...ids.entries()].map(([id, threadId]) => ({ id, threadId })),
      nextCursor: { value: latest },
      reset: false,
    }
  }

  private async bootstrap(opts: ListNewOptions): Promise<ListNewResult> {
    // Take the history id first, then list: anything arriving in between is covered by the next run.
    const profile = await this.api.users.getProfile({ userId: 'me' })
    const historyId = profile.data.historyId
    if (!historyId) throw new Error('gmail: profile has no historyId')
    // Every message of the window: the cursor jumps to `historyId` afterwards, so anything not
    // listed here would never be seen again (history.list only reports later additions).
    const messages: ProviderMessageRef[] = []
    let pageToken: string | undefined
    do {
      const res = await this.api.users.messages.list({
        userId: 'me',
        labelIds: ['INBOX'],
        q: `newer_than:${Math.max(1, opts.bootstrapDays)}d`,
        maxResults: 500,
        pageToken,
      })
      for (const m of res.data.messages ?? []) {
        if (m.id) messages.push({ id: m.id, threadId: m.threadId ?? null })
      }
      pageToken = res.data.nextPageToken ?? undefined
    } while (pageToken && messages.length < BOOTSTRAP_MAX_MESSAGES)
    return { messages, nextCursor: { value: historyId }, reset: true }
  }

  async fetch(ref: ProviderMessageRef): Promise<FetchedRaw> {
    const res = await this.api.users.messages.get({ userId: 'me', id: ref.id, format: 'raw' })
    if (!res.data.raw) throw new Error(`gmail: message ${ref.id} has no raw body`)
    return {
      raw: Buffer.from(res.data.raw, 'base64url'),
      threadId: res.data.threadId ?? ref.threadId ?? null,
    }
  }

  async send(mail: OutgoingMail): Promise<SendResult> {
    const raw = (await buildMime(mail)).toString('base64url')
    const res = await this.api.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId: mail.threadId ?? undefined },
    })
    if (!res.data.id) throw new Error('gmail: send returned no message id')
    return { providerMessageId: res.data.id, threadId: res.data.threadId ?? null }
  }

  async findSentByRfcMessageId(rfcMessageId: string): Promise<SendResult | null> {
    const bare = rfcMessageId.replace(/^<|>$/g, '')
    const res = await this.api.users.messages.list({
      userId: 'me',
      q: `rfc822msgid:${bare}`,
      maxResults: 1,
      includeSpamTrash: true,
    })
    const m = res.data.messages?.[0]
    return m?.id ? { providerMessageId: m.id, threadId: m.threadId ?? null } : null
  }

  async markProcessed(ref: ProviderMessageRef): Promise<void> {
    await this.api.users.messages.modify({
      userId: 'me',
      id: ref.id,
      requestBody: { removeLabelIds: ['UNREAD'] },
    })
  }
}
