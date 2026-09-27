/**
 * Mail configuration from the environment (IRDR-455). Variable names are in .env.example.
 * Provider selection: MAIL_PROVIDER=gmail|imap|fake, or inferred from the credentials present;
 * without any credentials the in-memory fake is used (tests, dev server).
 */
import type { MailProviderKind } from './types'

export interface GmailConfig {
  clientId: string | null
  clientSecret: string | null
  refreshToken: string | null
  serviceAccountJson: string | null
  impersonateUser: string | null
}

export interface ImapConfig {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  /** Sent folder path; detected via the \Sent special-use flag when empty. */
  sentFolder: string | null
  /** Append sent mail to the Sent folder (Gmail's SMTP does this by itself). */
  appendSent: boolean
}

export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string | null
  password: string | null
}

export interface MailConfig {
  provider: MailProviderKind
  /** support@instaradar.app */
  mailbox: string
  fromName: string
  notifyEmail: string | null
  /** Messages handled per fetch run. */
  fetchLimit: number
  bootstrapDays: number
  markRead: boolean
  /** Dev only: the fake provider ingests .eml files from this folder. */
  fakeDir: string | null
  /** A `sending` row older than this is treated as stuck and taken over (after asking the provider). */
  stuckSendMinutes: number
  /** Accepted clock drift for the Linear webhook timestamp. */
  gmail: GmailConfig | null
  imap: ImapConfig | null
  smtp: SmtpConfig | null
}

type Env = Record<string, string | undefined>

const str = (v: string | undefined): string | null => {
  const t = (v ?? '').trim()
  return t.length ? t : null
}
const int = (v: string | undefined, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}
const bool = (v: string | undefined, fallback: boolean): boolean => {
  const t = (v ?? '').trim().toLowerCase()
  if (!t) return fallback
  return t === 'true' || t === '1' || t === 'yes'
}

export function hasGmailCredentials(env: Env): boolean {
  return Boolean(
    (env.GMAIL_OAUTH_CLIENT_ID && env.GMAIL_OAUTH_CLIENT_SECRET && env.GMAIL_OAUTH_REFRESH_TOKEN) ||
    env.GMAIL_SERVICE_ACCOUNT_JSON,
  )
}

export class MailConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MailConfigError'
  }
}

/** Explicit MAIL_PROVIDER wins; otherwise the credentials decide; nothing configured means fake. */
export function detectProvider(env: Env = process.env): MailProviderKind {
  const explicit = (env.MAIL_PROVIDER ?? '').trim().toLowerCase()
  if (explicit === 'gmail' || explicit === 'imap' || explicit === 'fake') return explicit
  if (explicit)
    throw new MailConfigError(`MAIL_PROVIDER must be gmail, imap or fake, got "${explicit}"`)
  if (hasGmailCredentials(env)) return 'gmail'
  if (str(env.IMAP_HOST)) return 'imap'
  return 'fake'
}

export function mailConfigFromEnv(env: Env = process.env): MailConfig {
  const provider = detectProvider(env)
  const mailbox = (str(env.SUPPORT_MAILBOX) ?? 'support@instaradar.app').toLowerCase()
  const config: MailConfig = {
    provider,
    mailbox,
    fromName: str(env.MAIL_FROM_NAME) ?? 'Anastasia (InstaRadar Support)',
    notifyEmail: str(env.NOTIFY_EMAIL),
    fetchLimit: int(env.MAIL_FETCH_LIMIT, 50),
    bootstrapDays: int(env.MAIL_BOOTSTRAP_DAYS, 1),
    markRead: bool(env.MAIL_MARK_READ, false),
    fakeDir: str(env.MAIL_FAKE_DIR),
    stuckSendMinutes: int(env.MAIL_STUCK_SEND_MINUTES, 5),
    gmail: null,
    imap: null,
    smtp: null,
  }
  if (provider === 'gmail') {
    config.gmail = {
      clientId: str(env.GMAIL_OAUTH_CLIENT_ID),
      clientSecret: str(env.GMAIL_OAUTH_CLIENT_SECRET),
      refreshToken: str(env.GMAIL_OAUTH_REFRESH_TOKEN),
      serviceAccountJson: str(env.GMAIL_SERVICE_ACCOUNT_JSON),
      impersonateUser: str(env.GMAIL_IMPERSONATE_USER),
    }
    if (!hasGmailCredentials(env)) {
      throw new MailConfigError(
        'MAIL_PROVIDER=gmail needs GMAIL_OAUTH_CLIENT_ID + GMAIL_OAUTH_CLIENT_SECRET + GMAIL_OAUTH_REFRESH_TOKEN, or GMAIL_SERVICE_ACCOUNT_JSON (+ GMAIL_IMPERSONATE_USER)',
      )
    }
  }
  if (provider === 'imap') {
    const host = str(env.IMAP_HOST)
    const user = str(env.IMAP_USER)
    const password = str(env.IMAP_PASSWORD)
    const smtpHost = str(env.SMTP_HOST)
    if (!host || !user || !password || !smtpHost) {
      throw new MailConfigError(
        'MAIL_PROVIDER=imap needs IMAP_HOST, IMAP_USER, IMAP_PASSWORD and SMTP_HOST (SMTP_USER/SMTP_PASSWORD default to the IMAP ones)',
      )
    }
    const imapPort = int(env.IMAP_PORT, 993)
    const smtpPort = int(env.SMTP_PORT, 465)
    config.imap = {
      host,
      port: imapPort,
      secure: bool(env.IMAP_SECURE, imapPort === 993),
      user,
      password,
      sentFolder: str(env.IMAP_SENT_FOLDER),
      appendSent: bool(env.IMAP_APPEND_SENT, true),
    }
    config.smtp = {
      host: smtpHost,
      port: smtpPort,
      secure: bool(env.SMTP_SECURE, smtpPort === 465),
      user: str(env.SMTP_USER) ?? user,
      password: str(env.SMTP_PASSWORD) ?? password,
    }
  }
  return config
}

export function mailboxDomain(mailbox: string): string {
  const at = mailbox.lastIndexOf('@')
  return at >= 0 ? mailbox.slice(at + 1) : 'maelle.local'
}
