/** Provider factory (IRDR-455): MAIL_PROVIDER=gmail|imap|fake, see server/mail/config.ts. */
import { MailConfigError, type MailConfig } from './config'
import { DirectoryMailProvider, FakeMailProvider } from './providers/fake'
import { GmailProvider } from './providers/gmail'
import { ImapSmtpProvider } from './providers/imap'
import type { MailProvider } from './types'

export function createMailProvider(config: MailConfig): MailProvider {
  switch (config.provider) {
    case 'gmail':
      if (!config.gmail) throw new MailConfigError('gmail provider without credentials')
      return new GmailProvider(config.gmail, config.mailbox)
    case 'imap':
      if (!config.imap || !config.smtp)
        throw new MailConfigError('imap provider without credentials')
      return new ImapSmtpProvider(config.imap, config.smtp, config.mailbox)
    default:
      return config.fakeDir ? new DirectoryMailProvider(config.fakeDir) : new FakeMailProvider()
  }
}
