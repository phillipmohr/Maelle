/** Inbound mail pipeline against the real schema. Run with `pnpm test:db`. */
import { describe, expect, it } from 'vitest'
import { fetchMail } from '../../../server/mail/inbound'
import { buildEml, readFixture, uniqueMessageId } from '../../fixtures/mail'
import { insertOutboundMessage, makeMailContext, withRollback } from '../jobs/_db'

const url = process.env.TEST_DATABASE_URL

interface TicketRow {
  id: string
  status: string
  subject: string | null
  customer_name: string | null
  customer_email: string
  snoozed_until: Date | null
  closed_at: Date | null
  resolution: string | null
  first_message_at: Date | null
  last_message_at: Date | null
  last_customer_message_at: Date | null
}

describe.skipIf(!url)('inbound mail', () => {
  it('turns a new mail into a ticket, a message and an agent run; fetching twice changes nothing', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      ctx.provider.inject(readFixture('multipart'))
      const r1 = await fetchMail(ctx)
      expect(r1).toMatchObject({
        fetched: 1,
        ingested: 1,
        skipped: 0,
        ignored: 0,
        ticketsCreated: 1,
        reset: true,
      })

      const ticket = await db.one<TicketRow>(
        `select * from public.tickets where customer_email = 'tom.becker@example.com'`,
      )
      expect(ticket).toMatchObject({
        status: 'new',
        subject: 'Please cancel my subscription',
        customer_name: 'Tom Becker',
      })
      expect(ticket!.first_message_at?.toISOString()).toBe('2026-09-27T07:12:00.000Z')
      expect(ticket!.last_customer_message_at?.toISOString()).toBe('2026-09-27T07:12:00.000Z')

      const msg = await db.one<Record<string, unknown>>(
        'select * from public.messages where ticket_id = $1',
        [ticket!.id],
      )
      expect(msg).toMatchObject({
        direction: 'in',
        provider_message_id: 'fake-1',
        message_id: '<multipart-001@mail.example.com>',
        from_email: 'tom.becker@example.com',
        subject: 'Please cancel my subscription',
      })
      expect(msg!.text_body).toContain('cancel my subscription')
      expect(msg!.html_body).toContain('<div dir="ltr">')
      expect(msg!.text_stripped).toContain('Thanks,\nTom')
      expect(ctx.store.files.has(msg!.raw_storage_path as string)).toBe(true)

      const jobs = await db.query<{
        payload: { trigger: string }
        dedupe_key: string
        status: string
      }>(
        `select payload, dedupe_key, status from public.jobs where type = 'agent_run' and payload ->> 'ticketId' = $1`,
        [ticket!.id],
      )
      expect(jobs).toHaveLength(1)
      expect(jobs[0]).toMatchObject({ status: 'queued', payload: { trigger: 'new_ticket' } })
      expect(jobs[0]!.dedupe_key).toBe(`agent_run:${ticket!.id}:new_ticket:${msg!.id}`)

      const cursor = await db.one<{ cursor: string; last_result: Record<string, unknown> }>(
        `select cursor, last_result from public.mail_cursors where mailbox = 'support@instaradar.app'`,
      )
      expect(cursor).toMatchObject({ cursor: '1' })
      expect(cursor!.last_result).toMatchObject({ ingested: 1 })

      // Nothing new: no side effects.
      expect(await fetchMail(ctx)).toMatchObject({ fetched: 0, ingested: 0 })
      // The same mail delivered again under a new provider id: deduplicated by Message-ID.
      ctx.provider.inject(readFixture('multipart'))
      expect(await fetchMail(ctx)).toMatchObject({ fetched: 1, skipped: 1, ingested: 0 })
      expect(
        (await db.query('select id from public.messages where ticket_id = $1', [ticket!.id]))
          .length,
      ).toBe(1)
      expect(
        (
          await db.query(`select id from public.jobs where payload ->> 'ticketId' = $1`, [
            ticket!.id,
          ])
        ).length,
      ).toBe(1)
    })
  })

  it('threads a reply by In-Reply-To, moves waiting_on_customer to researching and enqueues customer_reply', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      ctx.provider.inject(readFixture('multipart'))
      await fetchMail(ctx)
      const ticket = (await db.one<TicketRow>(
        `select * from public.tickets where customer_email = 'tom.becker@example.com'`,
      ))!
      await insertOutboundMessage(db, ticket.id, {
        message_id: '<reply-from-support-1@instaradar.app>',
        to: 'tom.becker@example.com',
        sent_at: new Date('2026-09-27T12:00:00Z'),
      })
      await db.query(`update public.tickets set status = 'waiting_on_customer' where id = $1`, [
        ticket.id,
      ])

      ctx.provider.inject(readFixture('reply-plain'))
      const r = await fetchMail(ctx)
      expect(r).toMatchObject({ ingested: 1, ticketsCreated: 0 })
      const after = (await db.one<TicketRow>('select * from public.tickets where id = $1', [
        ticket.id,
      ]))!
      expect(after.status).toBe('researching')
      expect(after.last_customer_message_at?.toISOString()).toBe('2026-09-27T14:10:00.000Z')
      const messages = await db.query<{
        direction: string
        text_stripped: string | null
        in_reply_to: string | null
      }>(
        // created_at is the transaction start for every row inside withRollback, so order by the
        // message timestamps (07:12Z inbound, 12:00Z outbound, 14:10Z reply) instead.
        'select direction, text_stripped, in_reply_to from public.messages where ticket_id = $1 order by coalesce(received_at, sent_at), created_at',
        [ticket.id],
      )
      expect(messages.map((m) => m.direction)).toEqual(['in', 'out', 'in'])
      expect(messages[2]!.text_stripped).toBe(
        'Thanks Anastasia. Mostly the price, I only needed it for one project.\n\nTom',
      )
      expect(messages[2]!.in_reply_to).toBe('<reply-from-support-1@instaradar.app>')
      const runs = await db.query<{ payload: { trigger: string } }>(
        `select payload from public.jobs where type = 'agent_run' and payload ->> 'ticketId' = $1 order by created_at`,
        [ticket.id],
      )
      expect(runs.map((j) => j.payload.trigger)).toEqual(['new_ticket', 'customer_reply'])
      expect(
        (
          await db.query('select id from public.tickets where customer_email = $1', [
            'tom.becker@example.com',
          ])
        ).length,
      ).toBe(1)
    })
  })

  it.each([
    ['closed', { closed_at: new Date('2026-09-20T10:00:00Z'), resolution: 'approved' }],
    ['snoozed', { snoozed_until: new Date('2026-09-30T10:00:00Z') }],
    ['needs_decision', {}],
  ] as const)('reopens a %s ticket into researching and re-runs', async (status, extra) => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      ctx.provider.inject(readFixture('multipart'))
      await fetchMail(ctx)
      const ticket = (await db.one<TicketRow>(
        `select * from public.tickets where customer_email = 'tom.becker@example.com'`,
      ))!
      const cols = Object.keys(extra)
      await db.query(
        `update public.tickets set status = $2${cols.map((c, i) => `, ${c} = $${i + 3}`).join('')} where id = $1`,
        [ticket.id, status, ...Object.values(extra)],
      )
      ctx.provider.inject(
        buildEml({
          from: 'Tom Becker <tom.becker@example.com>',
          subject: 'Re: Please cancel my subscription',
          messageId: uniqueMessageId('reopen'),
          inReplyTo: '<multipart-001@mail.example.com>',
          references: ['<multipart-001@mail.example.com>'],
          text: 'Actually, one more thing.',
        }),
      )
      await fetchMail(ctx)
      const after = (await db.one<TicketRow>('select * from public.tickets where id = $1', [
        ticket.id,
      ]))!
      expect(after.status).toBe('researching')
      expect(after.snoozed_until).toBeNull()
      expect(after.closed_at).toBeNull()
      expect(after.resolution).toBeNull()
      const runs = await db.query<{ payload: { trigger: string } }>(
        `select payload from public.jobs where type = 'agent_run' and payload ->> 'ticketId' = $1 and payload ->> 'trigger' = 'customer_reply'`,
        [ticket.id],
      )
      expect(runs).toHaveLength(1)
    })
  })

  it('attaches a quick follow-up to a still new ticket without a second run', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      ctx.provider.inject(readFixture('multipart'))
      ctx.provider.inject(
        buildEml({
          from: 'Tom Becker <tom.becker@example.com>',
          subject: 'Re: Please cancel my subscription',
          messageId: uniqueMessageId('followup'),
          inReplyTo: '<multipart-001@mail.example.com>',
          text: 'PS: today please.',
        }),
      )
      await fetchMail(ctx)
      const ticket = (await db.one<TicketRow>(
        `select * from public.tickets where customer_email = 'tom.becker@example.com'`,
      ))!
      expect(ticket.status).toBe('new')
      expect(
        (await db.query('select id from public.messages where ticket_id = $1', [ticket.id])).length,
      ).toBe(2)
      expect(
        (
          await db.query(`select id from public.jobs where payload ->> 'ticketId' = $1`, [
            ticket.id,
          ])
        ).length,
      ).toBe(1)
    })
  })

  it('falls back to sender + normalised subject within 30 days, then the provider thread id', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      ctx.provider.inject(readFixture('multipart'))
      await fetchMail(ctx)
      const ticket = (await db.one<TicketRow>(
        `select * from public.tickets where customer_email = 'tom.becker@example.com'`,
      ))!

      // Same sender, same subject with prefixes, no headers → same ticket.
      ctx.provider.inject(
        buildEml({
          from: 'tom.becker@example.com',
          subject: 'AW: RE: please cancel my  subscription',
          messageId: uniqueMessageId('subj'),
          text: 'Any news?',
        }),
      )
      await fetchMail(ctx)
      expect(
        (await db.query('select id from public.messages where ticket_id = $1', [ticket.id])).length,
      ).toBe(2)

      // Different subject → new ticket.
      ctx.provider.inject(
        buildEml({
          from: 'tom.becker@example.com',
          subject: 'Invoice question',
          messageId: uniqueMessageId('other'),
          text: 'Where is my invoice?',
        }),
      )
      const r = await fetchMail(ctx)
      expect(r.ticketsCreated).toBe(1)

      // Older than 30 days → new ticket.
      await db.query(
        `update public.tickets set last_message_at = now() - interval '40 days', created_at = now() - interval '40 days' where id = $1`,
        [ticket.id],
      )
      ctx.provider.inject(
        buildEml({
          from: 'tom.becker@example.com',
          subject: 'Re: Please cancel my subscription',
          messageId: uniqueMessageId('old'),
          text: 'Hello again after a long time.',
        }),
      )
      expect((await fetchMail(ctx)).ticketsCreated).toBe(1)

      // Provider thread id (Gmail threadId) joins mail without headers and with another subject.
      ctx.provider.inject(
        buildEml({
          from: 'jonas.weber@example.de',
          subject: 'Count issue',
          messageId: uniqueMessageId('t1'),
          text: 'first',
        }),
        { threadId: 'gmail-thread-7' },
      )
      await fetchMail(ctx)
      ctx.provider.inject(
        buildEml({
          from: 'jonas.weber@example.de',
          subject: 'something else',
          messageId: uniqueMessageId('t2'),
          text: 'second',
        }),
        { threadId: 'gmail-thread-7' },
      )
      expect((await fetchMail(ctx)).ticketsCreated).toBe(0)
      const jonas = await db.query('select id from public.tickets where customer_email = $1', [
        'jonas.weber@example.de',
      ])
      expect(jonas).toHaveLength(1)
    })
  })

  it('ignores auto-replies, bounces, bulk and our own mail and records why', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      for (const f of ['auto-reply', 'bounce', 'bulk', 'own-sent'] as const)
        ctx.provider.inject(readFixture(f))
      const r = await fetchMail(ctx)
      expect(r).toMatchObject({ fetched: 4, ignored: 4, ingested: 0, ticketsCreated: 0 })
      expect(
        (
          await db.query('select id from public.tickets where customer_email in ($1, $2)', [
            'tom.becker@example.com',
            'news@saas-tools-weekly.example',
          ])
        ).length,
      ).toBe(0)
      const ignored = await db.query<{ reason: string; message_id: string }>(
        `select reason, message_id from public.mail_ignored order by created_at`,
      )
      expect(ignored.map((i) => i.reason.split(':')[0]).sort()).toEqual([
        'auto_reply',
        'bounce',
        'bulk',
        'own',
      ])
      expect(ctx.notify.calls).toHaveLength(0)
    })
  })

  it('alerts when a bounce refers to one of our replies', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      ctx.provider.inject(readFixture('multipart'))
      await fetchMail(ctx)
      const ticket = (await db.one<TicketRow>(
        `select * from public.tickets where customer_email = 'tom.becker@example.com'`,
      ))!
      await insertOutboundMessage(db, ticket.id, {
        message_id: '<reply-from-support-4809@instaradar.app>',
        to: 'daniel.okafor@example.com',
        sent_at: new Date(),
      })
      ctx.provider.inject(readFixture('bounce'))
      expect(await fetchMail(ctx)).toMatchObject({ ignored: 1 })
      expect(ctx.notify.calls).toHaveLength(1)
      expect(ctx.notify.calls[0]!.kind).toBe('system_alert')
      expect((ctx.notify.calls[0]!.payload as { title: string }).title).toMatch(/bounced/)
    })
  })

  it('stores attachments and keeps accents from non-English mail', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      ctx.provider.inject(readFixture('attachment'))
      ctx.provider.inject(readFixture('french'))
      expect(await fetchMail(ctx)).toMatchObject({ ingested: 2, ticketsCreated: 2 })

      const jonas = (await db.one<{ id: string }>(
        `select id from public.tickets where customer_email = 'jonas.weber@example.de'`,
      ))!
      const msg = (await db.one<{
        id: string
        attachments: { name: string; storagePath: string; contentType: string; sizeBytes: number }[]
      }>('select id, attachments from public.messages where ticket_id = $1', [jonas.id]))!
      expect(msg.attachments).toHaveLength(1)
      expect(msg.attachments[0]).toMatchObject({
        name: 'screenshot.png',
        contentType: 'image/png',
        storagePath: `tickets/${jonas.id}/${msg.id}/0-screenshot.png`,
      })
      expect(msg.attachments[0]!.sizeBytes).toBeGreaterThan(50)
      const stored = await ctx.store.get(msg.attachments[0]!.storagePath)
      expect(stored?.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')

      const elodie = (await db.one<TicketRow>(
        `select * from public.tickets where customer_email = 'elodie.martin@example.fr'`,
      ))!
      expect(elodie.subject).toBe("Problème d'accès à mon compte")
      expect(elodie.customer_name).toBe('Élodie Martin')
      const fr = (await db.one<{ text_body: string }>(
        'select text_body from public.messages where ticket_id = $1',
        [elodie.id],
      ))!
      expect(fr.text_body).toContain('facturée le 25 septembre')
    })
  })

  it('a failure in the middle of an ingest loses nothing and duplicates nothing', async () => {
    await withRollback(async (db) => {
      const ctx = makeMailContext(db)
      ctx.provider.inject(readFixture('multipart'))
      ctx.provider.inject(readFixture('french'))
      ctx.store.failNextPut = new Error('storage is down')
      await expect(fetchMail(ctx)).rejects.toThrow(/1 of 2 message\(s\) failed/)
      // The second message went through, the first was rolled back completely.
      expect(
        (
          await db.query(
            `select id from public.tickets where customer_email = 'tom.becker@example.com'`,
          )
        ).length,
      ).toBe(0)
      expect(
        (
          await db.query(
            `select id from public.tickets where customer_email = 'elodie.martin@example.fr'`,
          )
        ).length,
      ).toBe(1)
      expect(
        (
          await db.query(
            `select id from public.messages where message_id = '<multipart-001@mail.example.com>'`,
          )
        ).length,
      ).toBe(0)
      // The cursor did not move, so the failed message is listed again and the other one is skipped.
      const cursor = await db.one<{ cursor: string | null }>(
        `select cursor from public.mail_cursors`,
      )
      expect(cursor!.cursor).toBeNull()
      const r2 = await fetchMail(ctx)
      expect(r2).toMatchObject({ fetched: 2, ingested: 1, skipped: 1, failed: 0 })
      expect(
        (
          await db.query(
            `select id from public.tickets where customer_email in ('tom.becker@example.com', 'elodie.martin@example.fr')`,
          )
        ).length,
      ).toBe(2)
      expect((await db.query(`select id from public.jobs where type = 'agent_run'`)).length).toBe(2)
      expect(
        (await db.one<{ cursor: string }>(`select cursor from public.mail_cursors`))!.cursor,
      ).toBe('2')
    })
  })
})
