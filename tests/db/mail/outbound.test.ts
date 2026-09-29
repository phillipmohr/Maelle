/** Outbound mail: threading, storage and exactly-once sends. Run with `pnpm test:db`. */
import { afterAll, describe, expect, it } from 'vitest'
import type { ReplyDraft } from '../../../shared/proposal'
import { poolDb } from '../../../server/jobs/db'
import { fetchMail } from '../../../server/mail/inbound'
import { SendInProgressError, sendReply, sendSystemEmail } from '../../../server/mail/outbound'
import { parseMail } from '../../../server/mail/parse'
import { closeDbForTests } from '../../../server/utils/db'
import { readFixture } from '../../fixtures/mail'
import { insertTicket, makeMailContext, withRollback, type TestMailContext } from '../jobs/_db'

const url = process.env.TEST_DATABASE_URL

const draft = (to: string, over: Partial<ReplyDraft> = {}): ReplyDraft => ({
  template: null,
  templateNotionPageId: null,
  to,
  subject: 'Re: Please cancel my subscription',
  body: 'Hi, thanks for reaching out!\n\nI have cancelled your subscription, so you will not be charged again.\n\nBest regards,\nAnastasia',
  attachments: [],
  ...over,
})

async function ingestTom(ctx: TestMailContext): Promise<string> {
  ctx.provider.inject(readFixture('multipart'))
  await fetchMail(ctx)
  const t = await ctx.db.one<{ id: string }>(
    `select id from public.tickets where customer_email = 'tom.becker@example.com'`,
  )
  return t!.id
}

describe.skipIf(!url)('outbound mail', () => {
  afterAll(() => closeDbForTests())

  it('sends into the customer thread, stores the message, and a retry with the same key sends nothing', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      const ticketId = await ingestTom(ctx)
      const sent = await sendReply(ctx, ticketId, draft('tom.becker@example.com'), {
        sentBy: 'you',
        idempotencyKey: 'exec-1',
      })
      expect(ctx.provider.sent).toHaveLength(1)
      const mail = ctx.provider.sent[0]!.mail
      expect(mail).toMatchObject({
        to: ['tom.becker@example.com'],
        subject: 'Re: Please cancel my subscription',
        inReplyTo: '<multipart-001@mail.example.com>',
        references: ['<multipart-001@mail.example.com>'],
        messageId: sent.rfcMessageId,
      })
      expect(mail.from).toEqual({
        name: 'Anastasia at InstaRadar',
        address: 'support@instaradar.app',
      })
      const parsed = await parseMail(ctx.provider.sent[0]!.raw)
      expect(parsed.text).toContain('I have cancelled your subscription')
      // The signature from shared/config.ts is appended at send time, after the "-- " separator.
      expect(parsed.text).toContain('-- \nBest wishes,\nAnastasia\nCustomer Care · InstaRadar')
      expect(parsed.html).toContain('<p>Hi, thanks for reaching out!</p>')
      expect(parsed.html).toContain('Customer Care · InstaRadar')
      // Anastasia's photo rides along as an inline image referenced from the HTML signature.
      expect(parsed.html).toContain('src="cid:anastasia-photo@instaradar.app"')
      expect(parsed.attachments.filter((a) => a.inline).map((a) => a.filename)).toEqual([
        'anastasia.jpg',
      ])
      expect(parsed.inReplyTo).toBe('<multipart-001@mail.example.com>')

      const row = await db.one<Record<string, unknown>>(
        'select * from public.messages where id = $1',
        [sent.messageId],
      )
      expect(row).toMatchObject({
        direction: 'out',
        sent_by: 'you',
        message_id: sent.rfcMessageId,
        in_reply_to: '<multipart-001@mail.example.com>',
        provider_message_id: sent.providerMessageId,
        from_email: 'support@instaradar.app',
        to_emails: ['tom.becker@example.com'],
        subject: 'Re: Please cancel my subscription',
      })
      expect(row!.sent_at).toBeInstanceOf(Date)
      expect(ctx.store.files.has(row!.raw_storage_path as string)).toBe(true)
      const send = await db.one<{ status: string; attempts: number }>(
        `select status, attempts from public.mail_sends where idempotency_key = $1`,
        [`reply:${ticketId}:exec-1`],
      )
      expect(send).toEqual({ status: 'sent', attempts: 1 })
      const ticket = await db.one<{ last_message_at: Date }>(
        'select last_message_at from public.tickets where id = $1',
        [ticketId],
      )
      expect(ticket!.last_message_at.toISOString()).toBe(ctx.clock.now.toISOString())

      const again = await sendReply(ctx, ticketId, draft('tom.becker@example.com'), {
        idempotencyKey: 'exec-1',
      })
      expect(again).toEqual(sent)
      expect(ctx.provider.sent).toHaveLength(1)
      expect(
        (
          await db.query('select id from public.messages where ticket_id = $1 and direction = $2', [
            ticketId,
            'out',
          ])
        ).length,
      ).toBe(1)

      // A different draft subject keeps the thread's subject so mail clients keep the thread together.
      await sendReply(
        ctx,
        ticketId,
        draft('tom.becker@example.com', { subject: 'Your cancellation' }),
        { idempotencyKey: 'exec-2' },
      )
      expect(ctx.provider.sent[1]!.mail.subject).toBe('Re: Please cancel my subscription')
    })
  })

  it('a provider failure is recorded and the retry sends exactly once', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      const ticketId = await ingestTom(ctx)
      ctx.provider.failNextSend = new Error('smtp down')
      await expect(
        sendReply(ctx, ticketId, draft('tom.becker@example.com'), { idempotencyKey: 'k' }),
      ).rejects.toThrow('smtp down')
      const failed = await db.one<{ status: string; last_error: string }>(
        `select status, last_error from public.mail_sends where idempotency_key = $1`,
        [`reply:${ticketId}:k`],
      )
      expect(failed!.status).toBe('failed')
      expect(failed!.last_error).toContain('smtp down')
      expect(
        (
          await db.query('select id from public.messages where ticket_id = $1 and direction = $2', [
            ticketId,
            'out',
          ])
        ).length,
      ).toBe(0)

      const sent = await sendReply(ctx, ticketId, draft('tom.becker@example.com'), {
        idempotencyKey: 'k',
      })
      expect(ctx.provider.sent).toHaveLength(1)
      expect(sent.rfcMessageId).toBe(ctx.provider.sent[0]!.mail.messageId)
      const ok = await db.one<{ status: string; attempts: number }>(
        `select status, attempts from public.mail_sends where idempotency_key = $1`,
        [`reply:${ticketId}:k`],
      )
      expect(ok).toEqual({ status: 'sent', attempts: 2 })
    })
  })

  it('a send that succeeded but was never recorded is recovered without a second send', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      const ticketId = await ingestTom(ctx)
      ctx.provider.failAfterNextSend = new Error('socket hang up')
      await expect(
        sendReply(ctx, ticketId, draft('tom.becker@example.com'), { idempotencyKey: 'k' }),
      ).rejects.toThrow('socket hang up')
      expect(ctx.provider.sent).toHaveLength(1)

      const sent = await sendReply(ctx, ticketId, draft('tom.becker@example.com'), {
        idempotencyKey: 'k',
      })
      expect(ctx.provider.sent).toHaveLength(1)
      expect(sent.rfcMessageId).toBe(ctx.provider.sent[0]!.mail.messageId)
      expect(sent.providerMessageId).toBe(ctx.provider.sent[0]!.id)
      expect(
        (
          await db.query('select id from public.messages where ticket_id = $1 and direction = $2', [
            ticketId,
            'out',
          ])
        ).length,
      ).toBe(1)
    })
  })

  it('takes over a stale sending row after the timeout and leaves a fresh one alone', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      const ticketId = await ingestTom(ctx)
      await db.query(
        `insert into public.mail_sends (idempotency_key, ticket_id, kind, status, to_emails, subject, rfc_message_id, started_at)
         values ($1, $2, 'reply', 'sending', '{tom.becker@example.com}', 'Re: x', '<stuck@instaradar.app>', $3)`,
        [`reply:${ticketId}:stuck`, ticketId, new Date(ctx.clock.now.getTime() - 10 * 60_000)],
      )
      const sent = await sendReply(ctx, ticketId, draft('tom.becker@example.com'), {
        idempotencyKey: 'stuck',
      })
      expect(sent.rfcMessageId).toBe('<stuck@instaradar.app>')
      expect(ctx.provider.sent[0]!.mail.messageId).toBe('<stuck@instaradar.app>')

      await db.query(
        `insert into public.mail_sends (idempotency_key, ticket_id, kind, status, to_emails, subject, rfc_message_id, started_at)
         values ($1, $2, 'reply', 'sending', '{tom.becker@example.com}', 'Re: x', '<fresh@instaradar.app>', $3)`,
        [`reply:${ticketId}:fresh`, ticketId, ctx.clock.now],
      )
      await expect(
        sendReply(ctx, ticketId, draft('tom.becker@example.com'), { idempotencyKey: 'fresh' }),
      ).rejects.toBeInstanceOf(SendInProgressError)
      expect(ctx.provider.sent).toHaveLength(1)
    })
  })

  it('attaches files from storage and refuses to send when one is missing', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      const ticketId = await ingestTom(ctx)
      await ctx.store.put('tickets/x/refund.pdf', Buffer.from('%PDF-1.4 fake'), 'application/pdf')
      const withFile = draft('tom.becker@example.com', {
        attachments: [
          {
            name: 'refund.pdf',
            storagePath: 'tickets/x/refund.pdf',
            contentType: 'application/pdf',
            sizeBytes: 13,
          },
        ],
      })
      await sendReply(ctx, ticketId, withFile, { idempotencyKey: 'a1' })
      const parsed = await parseMail(ctx.provider.sent[0]!.raw)
      expect(parsed.attachments.filter((a) => !a.inline).map((a) => a.filename)).toEqual([
        'refund.pdf',
      ])

      const missing = draft('tom.becker@example.com', {
        attachments: [
          { name: 'gone.pdf', storagePath: 'tickets/x/gone.pdf', contentType: 'application/pdf' },
        ],
      })
      await expect(sendReply(ctx, ticketId, missing, { idempotencyKey: 'a2' })).rejects.toThrow(
        /missing from storage/,
      )
      expect(ctx.provider.sent).toHaveLength(1)
      const row = await db.one<{ status: string }>(
        `select status from public.mail_sends where idempotency_key = $1`,
        [`reply:${ticketId}:a2`],
      )
      expect(row!.status).toBe('failed')
    })
  })

  it('a ticket without inbound mail gets a fresh mail with the draft subject', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      const ticketId = await insertTicket(db, {
        customer_email: 'kate.morgan@example.com',
        subject: 'Release: Chronological follower list',
        case_type: 'release_notification',
        status: 'executing',
      })
      await sendReply(
        ctx,
        ticketId,
        draft('kate.morgan@example.com', { subject: 'Your requested feature is live' }),
        { sentBy: 'auto', idempotencyKey: 'r1' },
      )
      const mail = ctx.provider.sent[0]!.mail
      expect(mail.subject).toBe('Your requested feature is live')
      expect(mail.inReplyTo).toBeNull()
      expect(mail.references).toEqual([])
      const row = await db.one<{ sent_by: string }>(
        'select sent_by from public.messages where ticket_id = $1',
        [ticketId],
      )
      expect(row!.sent_by).toBe('auto')
    })
  })

  it('system emails go to the notify address and identical ones are sent once per day', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      await sendSystemEmail(ctx, '', 'Mail fetch failing', 'fetch_mail failed 3 times in a row')
      await sendSystemEmail(ctx, '', 'Mail fetch failing', 'fetch_mail failed 3 times in a row')
      await sendSystemEmail(ctx, 'other@example.com', 'Daily digest', 'Nothing to report.')
      expect(ctx.provider.sent.map((s) => s.mail.to[0])).toEqual([
        'phillip@example.com',
        'other@example.com',
      ])
      const rows = await db.query<{ kind: string; status: string }>(
        `select kind, status from public.mail_sends where kind = 'system'`,
      )
      expect(rows).toEqual([
        { kind: 'system', status: 'sent' },
        { kind: 'system', status: 'sent' },
      ])
    })
  })

  it('concurrent sends with the same key send exactly once (pool, committed)', async () => {
    const db = poolDb()
    const ctx = makeMailContext(db)
    const ticket = await db.one<{ id: string; last_message_at: Date | null }>(
      'select id, last_message_at from public.tickets where display_number = 4822',
    )
    expect(ticket).not.toBeNull()
    const key = `concurrent-${process.pid}-${Date.now()}`
    const results: string[] = []
    try {
      const settled = await Promise.allSettled([
        sendReply(ctx, ticket!.id, draft('marco.bianchi@example.com'), { idempotencyKey: key }),
        sendReply(ctx, ticket!.id, draft('marco.bianchi@example.com'), { idempotencyKey: key }),
        sendReply(ctx, ticket!.id, draft('marco.bianchi@example.com'), { idempotencyKey: key }),
      ])
      expect(ctx.provider.sent).toHaveLength(1)
      const fulfilled = settled.filter((s) => s.status === 'fulfilled')
      expect(fulfilled.length).toBeGreaterThanOrEqual(1)
      for (const s of settled) {
        if (s.status === 'fulfilled') results.push(s.value.messageId)
        else expect(s.reason).toBeInstanceOf(SendInProgressError)
      }
      expect(new Set(results).size).toBe(1)
    } finally {
      await db.query('delete from public.mail_sends where idempotency_key = $1', [
        `reply:${ticket!.id}:${key}`,
      ])
      if (results.length) await db.query('delete from public.messages where id = $1', [results[0]])
      await db.query('update public.tickets set last_message_at = $2 where id = $1', [
        ticket!.id,
        ticket!.last_message_at,
      ])
    }
  })
})
