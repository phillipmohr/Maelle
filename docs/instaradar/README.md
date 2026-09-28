# InstaRadar-side changes for the Maelle executor (IRDR-457)

The two actions that write InstaRadar data (`remove_from_tracking`, `delete_account`) are isolated
behind `InstaradarWriteClient` (`server/executor/clients/instaradar.ts`). Table and column names are
the InstaRadar database's, read from the Supabase project on 2026-09-28 and fixed in
`shared/config.ts` (`INSTARADAR.db`). This folder is the ready-to-apply proposal for the InstaRadar
repo: the blocklist table, the executor role and the app checks.

## What the InstaRadar database looks like

- `public.profile` (`id` = the Supabase auth user id, `email`, `created_at`, `stripe_customer_id`);
  created by the `handle_new_user` trigger on `auth.users`.
- `public.subscription` (`user_id`, `plan`, `status`, `stripe_customer_id`, `stripe_subscription_id`,
  `current_period_end`, `cancel_at_period_end`, `canceled_at`, `paused_at`).
- `public.tracked_profiles` (`tracked_profile_id`, `user_id`, `instagram_username`, `is_active`,
  `last_scanned_at`, ...). Every `tracked_*`, `scan_*`, `activity_events`, `notification_batches`,
  `notification_settings` and `manual_scan_requests` row cascades from it.
- `public.notification_log` (`user_id`, `tracked_profile_id`, `channel`, `event_type`, `status`).
- `public.referrals` (`referrer_user_id`, `referee_user_id`), `public.user_notification_settings`
  (cascades from `profile`).
- No blocklist and no account-deletion function exist yet (assumptions A1 and A3 below).

## Assumptions still to confirm

| #   | Assumption                                                                                                                                                      | Where it matters                                                                | If it is wrong                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A1  | InstaRadar's `customer.subscription.deleted` Stripe webhook already deletes the customer's tracked profiles and their history.                                  | `cancel_immediately` only cancels in Stripe and does not touch InstaRadar data. | Add the deletion to the webhook handler (preferred) or tell IRDR-457 to add an InstaRadar write. |
| A3  | There is no existing "delete my account" server function. Deletion = delete the user's rows in `INSTARADAR.db.userTables` (children first), then the auth user. | `delete_account`                                                                | Expose the existing function as `public.delete_user_account(uuid)` and point the client at it.   |
| A5  | `instagram_username` is stored lowercase without the `@`. The executor lowercases and strips `@` before writing.                                                | blocklist lookups                                                               | Add a `lower()` index or normalise on write.                                                     |

## 1. Blocklist table (`blocked_profiles.sql`)

`public.blocked_profiles` is the single source of truth for "this Instagram profile can neither be
tracked nor viewed on InstaRadar". One row per username, with the reason and the Maelle ticket that
caused it. RLS: readable by nobody but the service role and the executor role (users must not be
able to enumerate who asked to be removed).

The executor writes a row (`insert … on conflict do nothing`) and deletes the profile's rows from
`tracked_profiles` in the same transaction ("stop existing tracking by all users"). Hiding stored
data and blocking re-adding are InstaRadar app checks (section 3), because only the app knows every
place a profile can appear.

## 2. Executor database role (`executor-role.sql`)

`maelle_executor` is a login role with exactly the grants the two actions need:

- `INSERT, SELECT` on `blocked_profiles` (block, detect "already blocked")
- `SELECT, DELETE` on `tracked_profiles` (stop tracking, detect the user)
- `SELECT, DELETE` on `notification_log`, `manual_scan_requests`, `subscription`, `referrals` and
  `profile` (account deletion, children first; the cascades handle the rest)
- `USAGE` on the schema, a `statement_timeout` of 20 s, no `CREATE`, no other tables

Its connection string becomes `INSTARADAR_DB_WRITE_URL` in Maelle. The agent's `INSTARADAR_DB_READ_URL`
role stays SELECT-only (it also needs `SELECT` on `auth.users` and `auth.audit_log_entries` for the
last sign-in and the sign-in history; without those grants the agent simply reports them as
unavailable) and must not see `blocked_profiles` reasons if that is considered sensitive.

## 3. Application checks (`app-checks.md`)

Three places in the InstaRadar app have to consult the blocklist:

1. **Adding a profile** (the "track" endpoint / server action): refuse with a neutral message
   ("This profile is not available on InstaRadar") when `blocked_profiles` has the username.
2. **Scanning** (the scan worker / cron): skip blocked usernames, and remove any tracked rows that
   slipped through, so no new data is collected.
3. **Displaying** (profile pages, search, exports, notifications): filter blocked usernames out of
   every read path, or expose the read paths through views that join against the blocklist. Stored
   snapshots stay in the database (nothing is destroyed on the InstaRadar side beyond the tracking
   rows) but are never shown again.

`app-checks.md` has the SQL view and the TypeScript guard the endpoints can share.

## 4. Optional: server functions instead of raw table access

If Phillip prefers not to grant table-level DELETE to an external role, InstaRadar can expose two
`security definer` functions and grant the executor role `EXECUTE` only:

```sql
create or replace function public.block_profile(p_username text, p_reason text, p_source text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_inserted int; v_removed int;
begin
  insert into public.blocked_profiles (username, reason, source) values (lower(p_username), p_reason, p_source)
    on conflict (username) do nothing;
  get diagnostics v_inserted = row_count;
  delete from public.tracked_profiles where lower(instagram_username) = lower(p_username);
  get diagnostics v_removed = row_count;
  return jsonb_build_object('alreadyBlocked', v_inserted = 0, 'trackingStopped', v_removed);
end $$;

create or replace function public.delete_user_account(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  delete from public.tracked_profiles where user_id = p_user_id;
  delete from public.notification_log where user_id = p_user_id;
  delete from public.manual_scan_requests where user_id = p_user_id;
  delete from public.subscription where user_id = p_user_id;
  delete from public.referrals where referee_user_id = p_user_id;
  delete from public.profile where id = p_user_id;
  return jsonb_build_object('deleted', true);
end $$;
```

The executor's `InstaradarWriteClient` would then get a `functions` mode; today it uses the
table-level statements described above. Decide one of the two before the first production run.

## 5. Account deletion and Supabase Auth

`delete_account` deletes the auth user through the **InstaRadar** project's Auth admin API (the
project URL is fixed in `shared/config.ts`, the key is `INSTARADAR_SUPABASE_SERVICE_ROLE_KEY`), not
through Maelle's own project. The service role key is powerful; keep it in Vercel's encrypted env
only. If InstaRadar's auth users should rather be deleted inside the same Postgres transaction
(`delete from auth.users where id = …`), grant the executor role `DELETE` on `auth.users` and say
so; the client can then do it in one transaction with the data rows.

Order of operations in the action: verify no active Stripe subscription → verify the account exists
and its email matches the ticket → delete data rows in one transaction → delete the auth user. A
retry after a failure between the last two steps finishes the job without erroring.
