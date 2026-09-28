/**
 * Mail configuration (IRDR-455). The mailbox, its IMAP and SMTP hosts, the sender name and the
 * tuning knobs are fixed in `shared/config.ts`; the environment carries only the mailbox password
 * (`MAIL_PASSWORD`). Without it the in-memory fake is used (tests, dev server), optionally fed from
 * `.eml` files in `MAIL_FAKE_DIR`.
 */
import { MAILBOX, OWNER } from '#shared/config'
import type { MailProviderKind } from './types'

export interface ImapConfig {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  /** Sent folder path; detected via the \Sent special-use flag when null. */
  sentFolder: string | null
  /** Append sent mail to the Sent folder so it shows up in the mailbox like a normal reply. */
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
  imap: ImapConfig | null
  smtp: SmtpConfig | null
}

type Env = Record<string, string | undefined>

const str = (v: string | undefined): string | null => {
  const t = (v ?? '').trim()
  return t.length ? t : null
}

export class MailConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MailConfigError'
  }
}

/** The real mailbox when its password is set, the in-memory fake otherwise. */
export function detectProvider(env: Env = process.env): MailProviderKind {
  return str(env.MAIL_PASSWORD) ? 'imap' : 'fake'
}

export function mailConfigFromEnv(env: Env = process.env): MailConfig {
  const provider = detectProvider(env)
  const config: MailConfig = {
    provider,
    mailbox: MAILBOX.address,
    fromName: MAILBOX.fromName,
    notifyEmail: OWNER.notifyEmail,
    fetchLimit: MAILBOX.fetchLimit,
    bootstrapDays: MAILBOX.bootstrapDays,
    markRead: MAILBOX.markRead,
    fakeDir: str(env.MAIL_FAKE_DIR),
    stuckSendMinutes: MAILBOX.stuckSendMinutes,
    imap: null,
    smtp: null,
  }
  if (provider === 'imap') {
    const password = str(env.MAIL_PASSWORD)!
    config.imap = {
      host: MAILBOX.imap.host,
      port: MAILBOX.imap.port,
      secure: MAILBOX.imap.secure,
      user: MAILBOX.address,
      password,
      sentFolder: null,
      appendSent: true,
    }
    config.smtp = {
      host: MAILBOX.smtp.host,
      port: MAILBOX.smtp.port,
      secure: MAILBOX.smtp.secure,
      user: MAILBOX.address,
      password,
    }
  }
  return config
}

export function mailboxDomain(mailbox: string): string {
  const at = mailbox.lastIndexOf('@')
  return at >= 0 ? mailbox.slice(at + 1) : 'maelle.local'
}
