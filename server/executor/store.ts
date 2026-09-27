/**
 * Maelle-side writes and reads the actions need (release_notifications, cancellation_reasons, the
 * daily refund totals). Behind an interface so the unit tests run every action without a database
 * and can inject a "Supabase: insert ... timed out" failure.
 */
import type pg from 'pg'
import { fromPgError, type ProviderError } from './errors'

export interface ReleaseNotificationInput {
  appId: string
  linearIssueId: string | null
  linearIssueIdentifier: string
  email: string
  ticketId: string
}

export interface CancellationReasonInput {
  ticketId: string
  customerEmail: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  feedback: string
  verbatimReason: string
}

export interface MaelleStore {
  /** Unique on (identifier, email): a second insert is a no-op and reports `inserted: false`. */
  insertReleaseNotification(input: ReleaseNotificationInput): Promise<{ inserted: boolean }>
  /** One row per (ticket, subscription, verbatim reason); a retry finds the first one. */
  insertCancellationReason(input: CancellationReasonInput): Promise<{ inserted: boolean }>
  /** Succeeded refunds of the current day in `timezone`, excluding the given base key (own attempts). */
  refundsToday(input: {
    timezone: string
    excludeBaseKey: string
  }): Promise<{ count: number; amountCents: number }>
}

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>
}

export function createPgStore(db: () => Queryable): MaelleStore {
  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (err) {
      throw fromPgError('Supabase', err)
    }
  }
  return {
    insertReleaseNotification: (input) =>
      run(async () => {
        const r = await db().query(
          `insert into public.release_notifications (app_id, linear_issue_id, linear_issue_identifier, email, ticket_id)
           values ($1, $2, $3, lower($4), $5)
           on conflict (linear_issue_identifier, email) do nothing`,
          [
            input.appId,
            input.linearIssueId,
            input.linearIssueIdentifier,
            input.email,
            input.ticketId,
          ],
        )
        return { inserted: (r.rowCount ?? 0) > 0 }
      }),
    insertCancellationReason: (input) =>
      run(async () => {
        const existing = await db().query(
          `select 1 from public.cancellation_reasons
           where ticket_id = $1 and verbatim_reason = $2 and stripe_subscription_id is not distinct from $3
           limit 1`,
          [input.ticketId, input.verbatimReason, input.stripeSubscriptionId],
        )
        if ((existing.rowCount ?? 0) > 0) return { inserted: false }
        await db().query(
          `insert into public.cancellation_reasons
             (ticket_id, customer_email, stripe_customer_id, stripe_subscription_id, stripe_feedback, verbatim_reason)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            input.ticketId,
            input.customerEmail,
            input.stripeCustomerId,
            input.stripeSubscriptionId,
            input.feedback,
            input.verbatimReason,
          ],
        )
        return { inserted: true }
      }),
    refundsToday: (input) =>
      run(async () => {
        const r = await db().query<{ count: number; amount: number }>(
          `select count(*)::int as count,
                  coalesce(sum(coalesce((result ->> 'amountCents')::int, 0)), 0)::int as amount
           from public.action_executions
           where action_type = 'refund_latest_payment'
             and status = 'succeeded'
             and (coalesce(finished_at, created_at) at time zone $1)::date = (now() at time zone $1)::date
             and idempotency_key <> $2
             and idempotency_key not like $3`,
          [input.timezone, input.excludeBaseKey, `${input.excludeBaseKey}:a%`],
        )
        return { count: r.rows[0]?.count ?? 0, amountCents: r.rows[0]?.amount ?? 0 }
      }),
  }
}

export interface FakeStore extends MaelleStore {
  readonly state: {
    releaseNotifications: ReleaseNotificationInput[]
    cancellationReasons: CancellationReasonInput[]
    refundsToday: { count: number; amountCents: number }
  }
  failNext(op: keyof MaelleStore, error: ProviderError): void
  reset(): void
}

export function createFakeStore(): FakeStore {
  const state: FakeStore['state'] = {
    releaseNotifications: [],
    cancellationReasons: [],
    refundsToday: { count: 0, amountCents: 0 },
  }
  const failures = new Map<string, ProviderError>()
  function maybeFail(op: string) {
    const f = failures.get(op)
    if (f) {
      failures.delete(op)
      throw f
    }
  }
  return {
    state,
    failNext(op, error) {
      failures.set(op, error)
    },
    reset() {
      state.releaseNotifications.length = 0
      state.cancellationReasons.length = 0
      state.refundsToday = { count: 0, amountCents: 0 }
      failures.clear()
    },
    async insertReleaseNotification(input) {
      maybeFail('insertReleaseNotification')
      const dup = state.releaseNotifications.some(
        (r) =>
          r.linearIssueIdentifier === input.linearIssueIdentifier &&
          r.email.toLowerCase() === input.email.toLowerCase(),
      )
      if (dup) return { inserted: false }
      state.releaseNotifications.push({ ...input, email: input.email.toLowerCase() })
      return { inserted: true }
    },
    async insertCancellationReason(input) {
      maybeFail('insertCancellationReason')
      const dup = state.cancellationReasons.some(
        (r) =>
          r.ticketId === input.ticketId &&
          r.verbatimReason === input.verbatimReason &&
          r.stripeSubscriptionId === input.stripeSubscriptionId,
      )
      if (dup) return { inserted: false }
      state.cancellationReasons.push({ ...input })
      return { inserted: true }
    },
    async refundsToday() {
      maybeFail('refundsToday')
      return { ...state.refundsToday }
    },
  }
}
