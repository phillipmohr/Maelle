/** Provider factory (IRDR-455): the IMAP/SMTP mailbox when MAIL_PASSWORD is set, the fake otherwise. */
import { MailConfigError, type MailConfig } from './config'
import { DirectoryMailProvider, FakeMailProvider } from './providers/fake'
import { ImapSmtpProvider } from './providers/imap'
import type { MailProvider } from './types'

export function createMailProvider(config: MailConfig): MailProvider {
  if (config.provider === 'imap') {
    if (!config.imap || !config.smtp) throw new MailConfigError('imap provider without credentials')
    return new ImapSmtpProvider(config.imap, config.smtp, config.mailbox)
  }
  return config.fakeDir ? new DirectoryMailProvider(config.fakeDir) : new FakeMailProvider()
}
