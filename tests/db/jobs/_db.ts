/**
 * Helpers for the database tests of the mail pipeline and the job runner (IRDR-455).
 * `withRollback` runs a test on one connection inside a transaction that is always rolled back, so
 * nothing leaks into the shared test database (other test files run in parallel against it).
 */
import pg from 'pg'
import type { NotifyFn, NotifyKind, NotifyPayloads } from '../../../shared/services'
import { clientDb, type Db } from '../../../server/jobs/db'
import { createMailContext, type MailContext } from '../../../server/mail/context'
import { mailConfigFromEnv } from '../../../server/mail/config'
import { FakeMailProvider } from '../../../server/mail/providers/fake'
import { MemoryAttachmentStore } from '../../../server/mail/storage'

export const TEST_URL = process.env.TEST_DATABASE_URL

export async function withRollback<T>(fn: (db: Db, client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: TEST_URL })
  await client.connect()
  try {
    await client.query('begin')
    try {
      return await fn(clientDb(client, { nested: true }), client)
    } finally {
      await client.query('rollback')
    }
  } finally {
    await client.end()
  }
}

export interface NotifySpy extends NotifyFn {
  calls: { kind: NotifyKind; payload: NotifyPayloads[NotifyKind] }[]
}

export function notifySpy(): NotifySpy {
  const calls: NotifySpy['calls'] = []
  const fn = (async (kind, payload) => {
    calls.push({ kind, payload })
  }) as NotifySpy
  fn.calls = calls
  return fn
}

export interface TestMailContext extends MailContext {
  provider: FakeMailProvider
  store: MemoryAttachmentStore
  notify: NotifySpy
  clock: { now: Date }
}

/** The clock starts after every fixture's Date header (received_at is never in the future). */
export function makeMailContext(db: Db, now = new Date('2026-09-27T20:00:00Z')): TestMailContext {
  const clock = { now }
  const provider = new FakeMailProvider()
  const store = new MemoryAttachmentStore()
  const notify = notifySpy()
  const ctx = createMailContext({
    db,
    provider,
    store,
    notify,
    now: () => clock.now,
    log: () => {},
    config: mailConfigFromEnv({
      MAIL_PROVIDER: 'fake',
      SUPPORT_MAILBOX: 'support@instaradar.app',
      NOTIFY_EMAIL: 'phillip@example.com',
      MAIL_STUCK_SEND_MINUTES: '5',
    }),
  })
  return Object.assign(ctx, { provider, store, notify, clock }) as TestMailContext
}

export async function appId(db: Db): Promise<string> {
  const row = await db.one<{ id: string }>(`select id from public.apps where key = 'instaradar'`)
  if (!row) throw new Error('seed app missing')
  return row.id
}

export async function insertTicket(
  db: Db,
  fields: Record<string, unknown> & { customer_email: string },
): Promise<string> {
  const app = await appId(db)
  const cols = ['app_id', ...Object.keys(fields)]
  const vals = [app, ...Object.values(fields)]
  const row = await db.one<{ id: string }>(
    `insert into public.tickets (${cols.map((c) => `"${c}"`).join(', ')})
     values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    vals,
  )
  return row!.id
}

export async function insertOutboundMessage(
  db: Db,
  ticketId: string,
  fields: {
    message_id: string
    to: string
    sent_at: Date
    subject?: string
    references?: string[]
  },
): Promise<string> {
  const row = await db.one<{ id: string }>(
    `insert into public.messages (ticket_id, direction, message_id, "references", from_email, from_name, to_emails, subject, text_body, sent_at, sent_by)
     values ($1, 'out', $2, $3, 'support@instaradar.app', 'Anastasia', $4, $5, 'Our reply', $6, 'you') returning id`,
    [
      ticketId,
      fields.message_id,
      fields.references ?? [],
      [fields.to],
      fields.subject ?? 'Re: test',
      fields.sent_at,
    ],
  )
  return row!.id
}
