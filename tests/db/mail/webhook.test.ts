/** Linear webhook → release notification tickets. Run with `pnpm test:db`. */
import { describe, expect, it } from 'vitest'
import {
  processLinearWebhook,
  signLinearBody,
  type LinearIssuePayload,
} from '../../../server/mail/linear-webhook'
import { appId, withRollback } from '../jobs/_db'

const url = process.env.TEST_DATABASE_URL
const secret = 'lin_wh_test_secret'
const now = new Date('2026-09-27T12:00:00Z')

function payload(over: Partial<LinearIssuePayload> = {}): LinearIssuePayload {
  return {
    action: 'update',
    type: 'Issue',
    data: {
      id: 'issue-uuid-1',
      identifier: 'IRDR-999',
      title: 'Fix follower count — chronological order',
      team: { id: 'team-1', key: 'IRDR', name: 'InstaRadar' },
      state: { id: 'state-done', type: 'completed', name: 'Done' },
    },
    updatedFrom: { stateId: 'state-progress', updatedAt: '2026-09-27T11:59:00Z' },
    webhookTimestamp: now.getTime(),
    ...over,
  }
}

function signed(p: LinearIssuePayload, key = secret) {
  const rawBody = JSON.stringify(p)
  return { rawBody, signature: signLinearBody(rawBody, key) }
}

describe.skipIf(!url)('Linear webhook', () => {
  it('creates one ticket per stored email, skips notified ones and is idempotent on retry', async () => {
    await withRollback(async (db) => {
      const app = await appId(db)
      const original = await db.one<{ id: string }>(
        `select id from public.tickets where display_number = 4819`,
      )
      await db.query(
        `insert into public.release_notifications (app_id, linear_issue_identifier, email, ticket_id, notified_at) values
           ($1, 'IRDR-999', 'Jonas.Weber@example.de', $2, null),
           ($1, 'IRDR-999', 'already@example.com', null, now() - interval '1 day'),
           ($1, 'IRDR-998', 'other.issue@example.com', null, null)`,
        [app, original?.id ?? null],
      )
      const { rawBody, signature } = signed(payload())
      const res = await processLinearWebhook({
        rawBody,
        signature,
        secret,
        db,
        now,
        teamKey: 'IRDR',
      })
      expect(res).toEqual({ ok: true, created: 1, skipped: 1, matched: true })

      const ticket = await db.one<Record<string, unknown>>(
        `select * from public.tickets where customer_email = 'jonas.weber@example.de' and case_type = 'release_notification'`,
      )
      expect(ticket).toMatchObject({
        status: 'new',
        subject: 'Release: Fix follower count - chronological order',
        case_type: 'release_notification',
      })
      expect(ticket!.tags).toEqual(['release_notification', 'IRDR-999'])
      if (original) expect(ticket!.customer_name).toBe('Jonas Weber')
      const rn = await db.one<{
        notified_at: Date | null
        notification_ticket_id: string | null
        linear_issue_id: string | null
      }>(
        `select notified_at, notification_ticket_id, linear_issue_id from public.release_notifications where linear_issue_identifier = 'IRDR-999' and lower(email) = 'jonas.weber@example.de'`,
      )
      expect(rn!.notified_at?.toISOString()).toBe(now.toISOString())
      expect(rn!.notification_ticket_id).toBe(ticket!.id)
      expect(rn!.linear_issue_id).toBe('issue-uuid-1')
      const job = await db.one<{ payload: { trigger: string }; dedupe_key: string }>(
        `select payload, dedupe_key from public.jobs where type = 'agent_run' and payload ->> 'ticketId' = $1`,
        [ticket!.id],
      )
      expect(job!.payload.trigger).toBe('release_notification')
      expect(job!.dedupe_key).toBe(`agent_run:${ticket!.id}:release_notification`)
      const untouched = await db.one<{ notified_at: Date | null }>(
        `select notified_at from public.release_notifications where linear_issue_identifier = 'IRDR-998'`,
      )
      expect(untouched!.notified_at).toBeNull()

      // Linear retries on anything but 200: the second delivery creates nothing.
      const retry = await processLinearWebhook({
        rawBody,
        signature,
        secret,
        db,
        now,
        teamKey: 'IRDR',
      })
      expect(retry).toEqual({ ok: true, created: 0, skipped: 2, matched: true })
      // Matching by issue id alone also works once the id is stored (only the row that got the id).
      const byId = signed(
        payload({
          data: {
            id: 'issue-uuid-1',
            title: 'Fix follower count',
            state: { type: 'completed' },
            team: { key: 'IRDR' },
          },
        }),
      )
      expect(
        await processLinearWebhook({ ...byId, secret, db, now, teamKey: 'IRDR' }),
      ).toMatchObject({ created: 0, skipped: 1 })
      expect(
        (
          await db.query(
            `select id from public.tickets where case_type = 'release_notification' and customer_email = 'jonas.weber@example.de'`,
          )
        ).length,
      ).toBe(1)
    })
  })

  it('rejects bad signatures, missing secrets and stale timestamps; ignores other events and teams', async () => {
    await withRollback(async (db) => {
      const { rawBody, signature } = signed(payload())
      await expect(
        processLinearWebhook({ rawBody, signature: 'ab'.repeat(32), secret, db, now }),
      ).rejects.toMatchObject({ status: 401 })
      await expect(
        processLinearWebhook({ rawBody, signature, secret: 'wrong', db, now }),
      ).rejects.toMatchObject({ status: 401 })
      await expect(
        processLinearWebhook({ rawBody, signature, secret: null, db, now }),
      ).rejects.toMatchObject({ status: 503 })
      const stale = signed(payload({ webhookTimestamp: now.getTime() - 60 * 60_000 }))
      await expect(processLinearWebhook({ ...stale, secret, db, now })).rejects.toMatchObject({
        status: 401,
      })
      await expect(
        processLinearWebhook({
          rawBody: '{not json',
          signature: signLinearBody('{not json', secret),
          secret,
          db,
          now,
        }),
      ).rejects.toMatchObject({ status: 400 })

      const started = signed(
        payload({ data: { ...payload().data, state: { type: 'started', name: 'In Progress' } } }),
      )
      expect(await processLinearWebhook({ ...started, secret, db, now })).toEqual({
        ok: true,
        created: 0,
        skipped: 0,
        matched: false,
      })
      const comment = signed(payload({ type: 'Comment' }))
      expect(await processLinearWebhook({ ...comment, secret, db, now })).toMatchObject({
        matched: false,
      })
      const otherTeam = signed(payload())
      expect(
        await processLinearWebhook({ ...otherTeam, secret, db, now, teamKey: 'INS' }),
      ).toMatchObject({ matched: false })
      expect(
        await processLinearWebhook({ ...otherTeam, secret, db, now, teamId: 'team-1' }),
      ).toMatchObject({ matched: true, created: 0 })
      expect(
        (
          await db.query(
            `select id from public.tickets where case_type = 'release_notification' and tags @> '{IRDR-999}'`,
          )
        ).length,
      ).toBe(0)
    })
  })
})
