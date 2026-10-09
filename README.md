# Maelle

Maelle is the AI business superbrain for running InstaRadar. The first area is **AnastasAI**, customer
support: every email to support@instaradar.app becomes a ticket, an agent researches it read-only and
prepares one decision (case, research, proposed actions, reply draft), Phillip approves with one key,
deterministic code executes the actions and writes an audit log.

Nothing happens without approval, and that is enforced by the system, not by the prompt: the agent
has no write credentials, the executor is the only code that changes anything, and the UI never gets
trusted by the server.

## Stack

Nuxt 4 (TypeScript strict, pnpm), Vercel, Supabase (Postgres, Auth, Realtime, Storage), Tailwind 4
with the Maelle design tokens, primitives built on reka-ui (the layer under shadcn-vue, restyled so
nothing looks like default shadcn), Claude API, Vitest, ESLint, Prettier.

## Run it locally

```bash
pnpm install
cp .env.example .env            # fill in what you have; everything is optional for the UI
pnpm dev                        # http://localhost:3000
```

Without a Supabase project, set `AUTH_DISABLED=true` in `.env`: the UI then runs against the seed
data served by the stubbed API routes (the design's sample tickets). `AUTH_DISABLED` is ignored in
production builds and by the server middleware outside `nuxt dev`.

Configuration is split in two: `.env.example` lists the secrets and per-environment values (Supabase,
the mailbox password, Stripe, the InstaRadar roles, the API tokens, the cron secret), and
`shared/config.ts` fixes everything else in code: the owner's email, the support mailbox with its
IMAP and SMTP hosts and the reply signature, the Linear team, the InstaRadar Supabase and Vercel
projects and table names, the Claude models, the agent, mail and job tuning. Change those in code,
not per environment. Development-only switches never go to Vercel: `AUTH_DISABLED=true`,
`MAIL_FAKE_DIR=<folder of .eml files>` for the fake mailbox, `EXECUTOR_USE_FAKES=true|false` and
`EXECUTOR_SEED_FAKES=false` for the executor's in-memory Stripe, Linear and InstaRadar,
`NUXT_PUBLIC_SITE_URL` to override the public URL (otherwise Vercel's production URL is used).

With a Supabase project:

```bash
# .env: SUPABASE_DB_URL, SUPABASE_SERVICE_ROLE_KEY (the project URL and publishable key are in shared/config.ts)
pnpm db:migrate                 # applies supabase/migrations, allow-lists OWNER.email (shared/config.ts)
pnpm db:seed                    # the design's sample data (idempotent)
pnpm db:types                   # regenerates shared/types/database.ts
pnpm db:reset -- --seed         # truncate + reseed (refuses non-local URLs without --force)
```

Auth is Supabase Auth with a single allowed user: only `OWNER.email` from `shared/config.ts` can sign in (magic link
or Google). Everything else is rejected by the server middleware, by RLS, and by a trigger on
`auth.users` that refuses to create any other account. Enable the Google provider in the Supabase
dashboard if you want the Google button to work.

Checks:

```bash
pnpm typecheck                  # vue-tsc
pnpm lint                       # eslint
pnpm test                       # vitest: contracts, seed, shortcuts
pnpm test:db                    # starts a local Postgres 16 (no Docker needed), applies shim +
                                # migrations, seeds, runs tests/db (RLS, allow-list trigger, constraints)
pnpm build                      # what Vercel runs
```

`pnpm test:db` needs the PostgreSQL server binaries (`initdb`, `pg_ctl`) or `TEST_DATABASE_URL`.
The Supabase CLI (`pnpm exec supabase`) is installed; `supabase start` works when Docker is available.

## Folder ownership

Tickets 2 to 6 are built by separate coding agents in parallel. They meet only through the schema,
the shared contracts and the service interfaces in `shared/`. Each folder has exactly one owner; changes
to shared code are additive only (new fields, new tables, new migrations, never renames or removals).

| Folder                                                                                                                                                                                                                                                                                                     | Owner                | What lives there                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/`                                                                                                                                                                                                                                                                                                  | IRDR-454 foundation  | `CaseType`, action registry, `Proposal` zod schema, status machine, service interfaces + stubs, API route types, seed data, generated DB types |
| `app/components/ui/`, `app/components/shell/`, `app/layouts/`, `app/composables/useShortcuts.ts`, `useShell.ts`, `useCommands.ts`, `app/assets/`                                                                                                                                                           | IRDR-454             | Design system, app shell (rail · list · detail · context), shortcut registry, ⌘K palette shell, `/dev/components`, `/login`                    |
| `supabase/migrations/20260927000000_foundation.sql`, `scripts/`, `server/middleware/`, `server/utils/`                                                                                                                                                                                                     | IRDR-454             | Schema, RLS, seed and migration scripts, auth middleware, service registry                                                                     |
| `server/mail/`, `server/jobs/`, `server/api/cron/`, `server/api/webhooks/`, `docs/adr/001-jobs.md`                                                                                                                                                                                                         | IRDR-455 mail + jobs | Fetch, thread, send, job runner, recurring jobs, Linear webhook, health alerts                                                                 |
| `server/agent/`, `server/api/agent/`, `server/api/tickets/[id]/rerun.post.ts`, `evals/`                                                                                                                                                                                                                    | IRDR-456 agent       | Claude tool-use loop, read-only tools, knowledge from Notion, policy guardrails, consistency check, eval fixtures                              |
| `server/executor/`, `server/api/tickets/[id]/*.post.ts` (approve, reject, manual-send, snooze, unsnooze, retry, mark-done, case, undo)                                                                                                                                                                     | IRDR-457 executor    | Decision API, the 11 actions, idempotency, audit log                                                                                           |
| `app/components/inbox/`, `app/components/ticket/`, `app/pages/anastasai/index.vue`, `app/pages/anastasai/t/[id].vue`, `server/api/tickets/index.get.ts`, `server/api/tickets/[id].get.ts`                                                                                                                  | IRDR-458 UI          | Inbox, ticket detail, decision bar, keyboard flow, Realtime                                                                                    |
| `server/autonomy/`, `server/notify/`, `server/learning/`, `server/api/autonomy/`, `server/api/activity/`, `server/api/playbook.get.ts`, `server/api/learning/`, `app/components/autonomy/`, `app/components/activity/`, `app/components/playbook/`, `app/pages/anastasai/{autonomy,activity,playbook}.vue` | IRDR-459 autonomy    | Autonomy page, activity log, playbook, notifications, learning loop                                                                            |

The foundation ships placeholder pages and seed-backed stub routes for every owner so the app runs
end to end from day one. Stubbed responses carry an `x-maelle-stub: <owner>` header. Owners replace
the stubs in place.

### Service registry

`server/utils/services.ts` starts with the stubs from `shared/services-stubs.ts`. Each owner registers
its implementation from a Nitro plugin in its own folder:

```ts
// server/plugins/mail.ts (IRDR-455)
export default defineNitroPlugin(() => registerService('mail', createMailService()))
```

Consumers only ever call `services.jobs.enqueue(...)`, `services.mail.sendReply(...)`,
`services.agent.run(...)`, `services.executor.*`, `services.autonomy.evaluate(...)`,
`services.notify(...)`. Job handlers for `agent_run`, `run_due_scheduled` and `daily_digest` are
registered with `services.jobs.registerHandler(...)` by the agent, executor and autonomy tickets.

### Database access from server code

Server code reads and writes Maelle's database through `server/utils/db.ts` (`dbQuery`, `dbOne`,
`withTransaction`, a `pg` pool on `SUPABASE_DB_URL`). The same SQL runs in `pnpm test:db` against the
local Postgres, so every ticket can test its queries without a Supabase project. `useServiceDb()`
(supabase-js with the service role) is for Storage and Auth admin calls. Routes fall back to the seed
data when no database is configured (`isDbConfigured()`), so the UI keeps working offline.

### Binding contracts (do not rename)

- Table names in `supabase/migrations/20260927000000_foundation.sql`. Status-like columns are text
  with CHECK constraints so a later migration can extend them.
- `shared/status.ts` `transition(from, to)`: the only way to change a ticket status.
- `shared/actions.ts`: the 11 actions, their zod param schemas, `irreversible`, `lockable`, order.
  `refund_latest_payment`, `cancel_immediately`, `delete_account` are irreversible and locked by default.
- `shared/case-types.ts`: 17 Notion template cases (labels are the exact Notion names, keys are
  snake_case) plus `release_notification` and `unclear`.
- `shared/proposal.ts` `ProposalSchema`: the agent's output contract, incl. registry order,
  Send reply last, no em dash, irreversible actions wait for confirmation in stage 1.
- `shared/api.ts`: route list with request and response types and the owner of each route.
- Environment variable names in `.env.example`.

## Design

The design lives in the Claude Design project (AnastasAI Screens). The imported source files are kept
under `docs/design/` (screens, design system bundle, styles). Tokens are in
`app/assets/css/tokens.css` (verbatim from the design system) and mapped to Tailwind in
`app/assets/css/main.css`. Fonts (Geist, Geist Mono, Instrument Serif) are self-hosted in
`app/assets/fonts/` and tracked in git; `pnpm fonts:fetch` checks them against Google Fonts
(`SHA256SUMS`) and `pnpm fonts:fetch --update` takes upstream changes. `/dev/components` shows
every shared component in every state.

Dark only. No icon set: locks, checkboxes and dots are CSS shapes. The proposal is the only lit
surface on a screen (`<Panel elevation="focus">`).

## Credentials and permissions

Every integration uses the narrowest key that can do its job. Names are in `.env.example`; only
secrets live there, everything else is fixed in `shared/config.ts`.

One key per service is enough:

| Variable                               | Used by                   | What it needs                                                                    |
| -------------------------------------- | ------------------------- | -------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`                    | agent (reads), executor   | the account's secret key, or a restricted key with the writes listed in IRDR-457 |
| `INSTARADAR_DB_URL`                    | agent (reads), executor   | a Postgres URL of the InstaRadar project (`docs/instaradar/executor-role.sql`)   |
| `INSTARADAR_SUPABASE_SERVICE_ROLE_KEY` | executor                  | delete the InstaRadar auth user                                                  |
| `NOTION_TOKEN`                         | agent, playbook, learning | an internal integration with read and insert content                             |
| `LINEAR_API_KEY`                       | agent (reads), executor   | read, create issues, create comments                                             |
| `LINEAR_WEBHOOK_SECRET`                | webhook route             | the webhook's signing secret                                                     |
| `VERCEL_API_TOKEN`                     | agent                     | read runtime logs of the InstaRadar project                                      |
| `CRON_SECRET`                          | cron routes               | bearer token the scheduler presents                                              |

The agent shares these keys with the executor and stays read-only by construction: its Stripe,
InstaRadar, Notion and Linear clients implement read calls only, and its module tree never imports
the executor (a test proves both). Separate least-privilege keys are not part of v1.
| `ANTHROPIC_API_KEY` | agent | Claude API |

## Deployment

Vercel picks up the Nuxt build automatically (`pnpm build`). A first deploy needs five values in the
Vercel project:

1. `SUPABASE_DB_URL` and `SUPABASE_SERVICE_ROLE_KEY`: connect the Vercel project to the Supabase
   project (Vercel → Integrations → Supabase) and they arrive by themselves as `POSTGRES_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`, which Maelle reads too. The project URL and publishable key are
   fixed in `shared/config.ts`.
2. `MAIL_PASSWORD`, `ANTHROPIC_API_KEY`, `CRON_SECRET`.

Every other variable in `.env.example` switches on one integration (Stripe, the InstaRadar roles,
Vercel logs, Notion, Linear) and can be added later; until then that source is reported as
unavailable and that action says "not configured". Cron schedules are in `vercel.json`
(see `docs/adr/001-jobs.md`).

### Database migrations on deploy

Every push to `main` runs `.github/workflows/cd-prod.yaml`, which calls the reusable
`.github/workflows/deploy.yaml` (same pipeline as InstaRadar): it links the Supabase CLI to the
production project and runs `supabase db push`, applying the pending files in `supabase/migrations`.
`pnpm db:migrate` records applied migrations in the same `supabase_migrations.schema_migrations` table
the CLI uses, so the two never re-apply each other's work. The workflow needs three repository secrets
(GitHub → Settings → Secrets and variables → Actions):

| Secret                      | Value                                                                 |
| --------------------------- | --------------------------------------------------------------------- |
| `SUPABASE_CLI_TOKEN`        | Personal access token (Supabase dashboard → Account → Access Tokens)  |
| `SUPABASE_PROD_REF`         | Project ref of Maelle's Supabase project (Project Settings → General) |
| `SUPABASE_PROD_DB_PASSWORD` | The project's database password                                       |

`supabase db push` only applies SQL; the one-time allow-listing of `OWNER.email` that
`pnpm db:migrate` does is not part of it, so run `pnpm db:migrate` once against the production URL
(or insert the row into `allowed_users` by hand) before the first sign-in.

## IRDR-459: Autonomy, activity log, playbook, notifications, learning loop

Owner folders: `server/autonomy/`, `server/notify/`, `server/learning/`, `server/api/autonomy/`,
`server/api/activity/`, `server/api/playbook.get.ts`, `server/api/learning/`, `server/plugins/autonomy.ts`,
`app/components/{autonomy,activity,playbook}/`, the three pages, `tests/autonomy/`, `tests/db/autonomy/`.
Migration `supabase/migrations/20260927010459_autonomy.sql` adds `settings_audit`, `notifications` and
`learning_events` (RLS, allow-list policy). Shared additions: `shared/autonomy.ts` (rules, zod schema
for PUT, audit summaries), `shared/activity.ts` (parameter and result formatting), optional fields merged
into `ActivityResponse`, `AutonomyResponse`, `PlaybookResponse` and `LearningResponse`.

### Autonomy page (`/anastasai/autonomy`, screen 1h)

- `GET /api/autonomy`: track record per template case type from the last 30 decisions
  (`decisions` joined with `tickets.case_type`; snoozed and marked_done are not verdicts), undo counts
  (Auto executions cancelled inside the undo window since the case went on Auto), settings, modes,
  effective locks. Recommendation rules, in order: on Auto (`On Auto since <date> · N undos`),
  irreversible actions, any rejection, fewer than 15 tickets (`Collecting · N more tickets`), at least
  90% unchanged (`Ready for Auto`), otherwise too many edits. Case types with fewer than 5 tickets
  collapse into one row. Without a database the seed answers (header `x-maelle-stub`).
- `PUT /api/autonomy` (`AutonomyUpdateRequest`, validated with `AutonomyUpdateSchema`): modes, locks and
  settings in one transaction, one `settings_audit` row per real change (who = session email, what,
  from, to). 503 without a database. Pause all is `settings.global_pause`; the rail note follows it.
- Locks: Refund latest payment, Cancel immediately and Delete account are locked by default
  (`ACTIONS[type].lockedByDefault` when no `action_locks` row exists).

### Auto path

`services.autonomy.evaluate(ticketId)` returns `'auto'` only when the case is on Auto, global pause
is off, neither the ticket nor the proposal is high risk or safety, the case is not unclear, the
proposal is not a hand-off, the proposal has no policy warnings, no customer confirmation is pending (stage 1), and no enabled action
is locked. Otherwise `'ask'`. The agent calls `services.executor.runAuto(ticketId)` on `'auto'`;
evaluate never executes anything. A safety or high-risk ticket triggers `notify('high_risk_ticket')`
once per ticket (deduped in `notifications`) on its way to `'ask'`. `evaluateDetailed()` exposes the
reason for logs and tests.

### Activity log (`/anastasai/activity`, screen 2c)

`GET /api/activity`: `action_executions` joined with tickets, filters `by=you|auto`,
`irreversibleOnly=true`, `from`, `to`, cursor pagination (`created_at desc, id desc`, `nextCursor`),
plus `settings` (the `settings_audit` rows of the same time range, shown as "Settings" entries).
`GET /api/activity/export.csv` takes the same filters and exports every matching row.

### Playbook (`/anastasai/playbook`)

Read-only links into Notion: protocol sections, the 17 templates with actions and "Confirm first",
Examples and Knowledge Base counts (live through `NOTION_TOKEN`, cached five minutes; snapshot
counts otherwise, `liveCounts` says which). While `KNOWLEDGE_BASE.enabled` is false the Knowledge
Base row reads "off" (`knowledgeBaseEnabled`) and is not queried.

### Notifications

`services.notify(kind, payload)` sends plain-text mail to `settings.notify_email`, else
`OWNER.notifyEmail` (`shared/config.ts`), through `services.mail.sendSystemEmail`, and logs every attempt in `notifications`
(`pending`, `sent`, `failed`, `skipped`). `high_risk_ticket` is deduped per ticket, `daily_digest`
per local day (`digest:YYYY-MM-DD` in the settings timezone), `system_alert` always sends. The
`daily_digest` job handler is registered in `server/plugins/autonomy.ts`; the digest covers
everything since the last sent digest: handled automatically, needs a decision, waiting, failed actions.

### Learning loop

- Notion writes go through `NotionWriter` (`server/learning/notion-writer.ts`): the real adapter uses
  `NOTION_TOKEN`, the in-memory fake serves tests and every environment without
  the token. Claude calls go through `ModelClient` (`ANTHROPIC_API_KEY`, model `MODELS.small`, i.e.
  `claude-sonnet-5-5`, low effort) with a deterministic fallback (first sentences of the reply).
- `POST /api/learning/example { ticketId }`: Draft page in the Examples DB (Name, Category, Customer
  message, Response, Status Draft). `POST /api/learning/kb-draft { ticketId }`: Draft page in the
  Knowledge Base (Name, Category, Type, Customer phrasing, Short answer, App InstaRadar, Status Draft,
  Related templates). Both return `{ notionPageId, url }`, are idempotent per ticket
  (`learning_events`), and need the ticket from the database (503 offline).
- The Examples data source got a `Status` select (Active, Draft) on 2026-09-27; the existing 10
  examples are Active. New examples arrive as Draft and are only used once Phillip sets them to Active.

## IRDR-457 · Executor: decision API, the 11 actions, idempotency, audit log

The executor (`server/executor/`) is the only code that changes anything: Stripe, InstaRadar data,
Linear, outgoing email, ticket state. The UI and Auto mode call the same decision API
(`server/api/tickets/[id]/*.post.ts`); the server never trusts the UI. `server/plugins/executor.ts`
registers it as `services.executor` and registers the `run_due_scheduled` job handler.

### Flow

1. **Decide** (one transaction, ticket row locked): status must allow the step (`transition()` from
   `shared/status.ts`), the proposal version must match, every action must be in the registry with
   valid params (shared zod schemas), an enabled irreversible `now` action needs
   `confirmIrreversible: true` (otherwise HTTP 409 with `{ error: 'confirm_required', irreversible }`).
   The `decisions` row is written (`approved` / `approved_with_edits` with `reply_diff` and
   `action_changes`, `time_to_decide_ms`), the `action_executions` rows are inserted-or-fetched by
   idempotency key, the ticket moves to `executing`.
2. **Run** (outside the transaction, one UPDATE per status change so Realtime shows progress): actions
   in registry order, Send reply last. A failure never stops an independent action. The reply is
   `held` only while an action with `required_for_reply` has not succeeded; otherwise it still sends.
   Auto runs schedule the reply (`scheduled`, `scheduled_for = now + undo window`) instead of sending.
3. **Finish** (one transaction): `closed` (resolution `approved`, `approved_with_edits`, `auto`,
   `handled_manually`, `rejected`, `closed_no_reply`), `action_failed` (any failure), `waiting_on_customer`
   (stage 1 with queued `after_confirmation` actions; `waiting_for` = "Waiting for “Yes, refund”") or
   `auto_pending` (Auto, until `runDueScheduled` sends the reply or `undo` cancels it).

### Idempotency and retries

- Base key `executionIdempotencyKey(ticketId, proposalVersion, position)`; manual sends use
  `<ticketId>:m<decisionId>:p<position>`. `action_executions.idempotency_key` is unique.
- A retry writes a **new row** with `attempt + 1` and the suffix `:a<attempt>` (as the seed shows for
  #4812); the failed row stays for the audit trail. Held rows are reused. Every external call uses
  the **base** key, so Stripe replays the first refund or cancellation, Linear is searched for the
  marker `Maelle ticket #<n>` before creating an issue or comment, and mail gets the same
  `idempotencyKey`. Refunds also carry `metadata.maelle_key`, so a retry after a lost response finds
  its own refund instead of creating a second one.
- Double submits of approve or retry are refused with 409: the second request finds the ticket no
  longer waiting (row lock + status machine).
- The UI should group executions by position (`idempotency_key` without the `:a<n>` suffix) and show
  the highest attempt.

### Errors for the UI

Plain words, then provider detail, then what did not happen, then the request id:
`Stripe: rate_limit (429) · nothing was charged or refunded · req_Qx91Lm`. Precondition failures read
`Not the latest payment: ch_… from Sep 20 is newer · nothing was charged or refunded`. Never an em dash.

### External systems

Each system sits behind an interface with a real adapter and an in-memory fake
(`server/executor/clients/`). A real adapter is constructed only when its credential is set. Without
one, `nuxt dev` and tests use the fakes; production gets a client whose calls fail with
`<Provider>: not_configured` so nothing is ever pretended. `EXECUTOR_USE_FAKES` overrides this.

| Variable                               | Used for                                                    | Permissions the key or role needs                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`                    | cancel, refund, stop retries, coupons, cancellation details | The account's secret key, or a restricted key with these permissions. **Write**: Subscriptions (`subscriptions.update`, `subscriptions.cancel`), Refunds (`refunds.create`), Coupons (`coupons.create`), Promotion codes (`promotion_codes.create`), Invoices (`invoices.update`, `invoices.mark_uncollectible`). **Read**: Customers, Charges, Payment intents, Refunds, Invoices, Subscriptions. Nothing else. Every write carries an `Idempotency-Key`. Test mode key while there is no production sign-off. |
| `INSTARADAR_DB_URL`                    | remove from tracking, delete account                        | Postgres role `maelle_executor` (see `docs/instaradar/executor-role.sql`): `USAGE` on the schema, `SELECT, INSERT` on `blocked_profiles`, `SELECT, DELETE` on `tracked_profiles` and on each table in `INSTARADAR.db.userTables` (`shared/config.ts`); `statement_timeout 20s`; no other grants.                                                                                                                                                                                                                |
| `INSTARADAR_SUPABASE_SERVICE_ROLE_KEY` | delete the InstaRadar auth user                             | The InstaRadar project's service role key (Auth admin `getUserById`, `deleteUser`); the project URL is fixed in `shared/config.ts`. Not Maelle's own project. Alternative in `docs/instaradar/README.md` section 5.                                                                                                                                                                                                                                                                                             |
| `LINEAR_API_KEY`                       | create issues, link existing ones                           | Personal or OAuth key with **Create issues** and **Create comments** (plus read to find the labels `Bug`/`Feature` and the marker). Team InstaRadar is fixed in `shared/config.ts`.                                                                                                                                                                                                                                                                                                                             |
| `SUPABASE_DB_URL`                      | Maelle's own tables                                         | The pooler URL; the executor writes `action_executions`, `decisions`, `release_notifications`, `cancellation_reasons`, `tickets`, `proposals.status`.                                                                                                                                                                                                                                                                                                                                                           |

Mail goes through `services.mail.sendReply(ticketId, draft, { sentBy, idempotencyKey })` (IRDR-455).

### Actions and their live checks

`cancel_at_period_end` (returns the access end date; already scheduled or cancelled is reported, not
failed) · `cancel_immediately` (InstaRadar deletes the tracked profiles through its
`customer.subscription.deleted` webhook, assumption A1 in `docs/instaradar/README.md`) ·
`refund_latest_payment` (latest succeeded charge of the customer only, not already refunded, amount ≤
payment, daily count and amount limits from `settings`, in `settings.timezone`) · `delete_account`
(no active subscription, explicit customer confirmation: stage 2, confirmation found in the thread,
or the approver's note says "confirmed"; email must match the auth user) · `stop_failed_payment_retries`
(cancelled or inactive subscriptions only; open invoices are marked uncollectible, falling back to
`auto_advance: false`) · `create_coupon` (applied to the subscription or a one-use promotion code
`IR-XXXXXX` for the reply) · `create_linear_ticket` (label Bug/Feature, description ends with
"Customer to notify once released: <email>" and the marker; an existing issue gets one comment with
the same line) · `store_release_notification_email` · `store_cancellation_reason` (Maelle row plus
Stripe `cancellation_details` while the subscription is not cancelled) · `remove_from_tracking`
(InstaRadar blocklist plus tracking rows removed) · `send_reply`.

### Auto

`executor.runAuto(ticketId)` refuses when the global pause is on, the ticket or proposal risk is
`high` or `safety`, the case is `unclear`, the proposal has policy warnings, a customer confirmation
is pending, the proposal has no reply, or any enabled action is locked (`action_locks`, or
`lockedByDefault` without a row). Otherwise it approves as `auto`: actions run now, the reply is
scheduled after `settings.undo_window_minutes`, the ticket is `auto_pending`. `runDueScheduled()`
(job `run_due_scheduled`) sends due replies and closes the tickets (resolution `auto`); a failed send
returns the ticket to `needs_decision` with the proposal active. `undo` cancels the scheduled reply,
returns the ticket to `needs_decision` and lists what already ran (also stored on the cancelled row).

### Tests

```bash
pnpm test                                        # tests/autonomy: rules, evaluate guards, notify, activity, learning
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/postgres TEST_DB_NAME=maelle_irdr459 pnpm test:db
```

## IRDR-458: inbox, ticket detail, decision bar and keyboard flow

The AnastasAI screens from the design (1b to 1f, 3a and 3b), built from the shared components.

- `app/pages/anastasai/index.vue` is the inbox: the lit "Needs decision" table (safety, then high
  risk, then the oldest first), parked rows (Waiting on customer, Snoozed, collapsed with Show),
  "Handled automatically" with Undo (only when tickets sit in the undo window), and the closed
  history with All / Approved / Edited / Rejected / Manual / Auto, F for case and date range, day
  groups and infinite scroll. `?preview=cleared` renders the cleared state (3b) in `nuxt dev`.
- `app/pages/anastasai/t/[id].vue` is the ticket: rail · list · detail · customer context. The
  proposal is the only lit surface; actions are a checklist with editable parameters and "+ Add
  action" from the registry; the reply draft has an editor (E, ⌘⏎ approves) and a check line; the
  research shows evidence tables and log lines on demand; the decision bar has the normal, confirm
  (ember, "Press A again") and failed modes plus the parked, researching, unclear, hand-off
  (⏎ take over: the ticket goes to manual and you write the reply), manual, auto and closed
  variants. A closed row opens read only (outcome, sent reply, audit trail).
- Components live in `app/components/inbox/` and `app/components/ticket/`; the view models and
  the decision state machine in `app/composables/useInboxRows.ts`, `useInboxFilters.ts`,
  `useTicketModel.ts`, `useTicketParams.ts`, `useTicketDecision.ts` (pure factory plus the Nuxt
  wrapper), data access in `useTickets.ts`, Realtime in `useRealtime.ts`.
- `GET /api/tickets` and `GET /api/tickets/:id` read the database when `SUPABASE_DB_URL` (or
  `TEST_DATABASE_URL`) is set, through `shared/ticket-repository.ts`, which feeds the DB rows to the
  same seed views the offline stub uses, so both modes agree. Without a database they answer from
  the seed. List semantics: no `status` returns every ticket, open first, then closed by
  `closed_at desc` (the palette search covers everything); `status=closed` is the paginated
  history (`cursor`, `nextCursor`, `closed_at desc, id desc`); `status=a,b` filters; `q`,
  `caseType`, `resolution`, `from`, `to`, `limit` as in `TicketListQuery`.
- Keyboard: J/K, ⏎ open (inbox) or retry (failed ticket), A approve (twice for irreversible
  actions), E edit, ⌘⏎ approve from the editor, Esc back or cancel, R reject (1 to 4 pick the
  reason), S snooze or unsnooze (1 to 3 pick a preset), M mark as done, F filters, ? shortcuts,
  ⌘K commands (approve, edit, reject, snooze, change case, re-run research, retry, mark done,
  unsnooze, undo, focus mode, context panel). Focus follows the selection so it is always visible.
- Decision API errors: 409 `confirm_required` enters confirm mode, 409 stale reloads the ticket,
  422 warns (safety), 501 says "Not available yet", network errors say so in plain words. After an
  approval with edits or a manual send the toast offers "Save as example?", after a proposal with
  `noKnowledgeFound` it offers "Create KB draft" (learning endpoints, IRDR-459) while the
  Knowledge Base is switched on.
- Realtime (`useRealtime`) subscribes to `tickets`, `agent_runs` and `action_executions` only when
  `runtimeConfig.public.supabase.url` is a real https URL; with the local placeholder it is a no-op.
- Tests: `tests/ui/` (view models, filters, params, the decision state machine and the keyboard
  flow under happy-dom) run with `pnpm test`; `tests/db/tickets/` run the list and detail queries
  against the seeded local Postgres with
  `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/postgres TEST_DB_NAME=maelle_irdr458 pnpm test:db`.

pnpm test # tests/executor: every action against the fakes, planner, errors, clients
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/postgres TEST_DB_NAME=maelle_irdr457 pnpm test:db

```

`tests/db/executor/` clones the seeded test database into its own database per file (so the
foundation's schema assertions never race with these mutations) and runs the flows on the design's
tickets: #4824 routine approve, #4809 confirm + irreversible, #4822 stage 1, #4820 retry of a failed
required action, plus edits, partial failures, reject, manual send, snooze, mark done, case override,
Auto refusals, Auto run, undo, due scheduled sends and the refund limits.
```

## IRDR-456 · AnastasAI agent run

`server/agent/` turns one ticket into one validated proposal: case, research with sources, actions
from the registry, reply draft. The agent reads everything and writes nothing outside Maelle's own
tables; that is enforced by construction, not by the prompt: its Stripe, InstaRadar, Notion and
Linear clients implement read calls only. `tests/agent/credentials.test.ts` proves the module tree
never imports the executor, that only `server/agent/config.ts` reads the environment, and that the
config accessor exposes the agent's own variables and none of the other secrets.

### How a run works

`services.agent.run(ticketId, trigger)` (registered from `server/plugins/agent.ts`, which also
registers the `agent_run` job handler):

1. `beginRun` creates the `agent_runs` row (or reuses the row of the same job id: retried jobs bump
   `attempt`, a finished job is not run twice). Status: `new` or `needs_decision` → `researching`
   through `transition()`; `waiting_on_customer`, `snoozed` and `closed` are accepted too when the
   mail ticket did not move the ticket yet.
2. **Deterministic pre-research** (`research.ts`) fetches Stripe, the InstaRadar database, the
   Vercel logs, Linear and the email history in parallel, each with its own timeout, and writes
   `agent_runs.progress` after every source settles (`stripe ✓ supabase ✓ vercel ⋯ kb ✓`). A source
   without credentials is `skipped`, a failing one `failed`, both with a research warning; neither
   blocks the proposal. The Stripe customer is found through the ticket email, then through emails
   and names mentioned in the message (a bank writes about its member).
3. `context.ts` derives the customer facts and the context panel snapshot (plan, status, renewal or
   cancellation date, customer since, card, payments and refunds timeline, tracked profiles, previous
   tickets, log errors with counts, tags such as Long-term, New customer, Refund used, Resubscribed,
   Business plan) in code.
4. **Claude tool-use loop** (`loop.ts`, `prompt.ts`, `tools/definitions.ts`): system prompt from the
   Notion protocol, the 17 templates, the examples, the knowledge base (only while
   `KNOWLEDGE_BASE.enabled`), the hand-off rule and the action registry
   (cached with `cache_control` across runs); user message with the thread, the research bundle,
   the facts and hints. The whole conversation is cached turn by turn (top-level `cache_control`),
   thinking depth is `AGENT.effort` (medium), and the prompt asks the model to submit routine cases
   without research and to make every needed tool call in one turn; from `AGENT.researchNudgeTurn`
   on, the tool results carry a nudge to submit with what is known (IRDR-463). Read-only tools:
   `stripe_events`, `stripe_search_customers`, `stripe_retrieve`, `instaradar_select` (one guarded
   SELECT), `instaradar_profile`, `vercel_logs`, `linear_search`, `notion_page`, `email_history`;
   results are cut at 12K characters because every later turn reads them again. Output only
   through `submit_proposal`.
5. `finalize.ts` owns what must not depend on the model: the confirmation stage
   (`customerConfirmationNeeded` follows the template plus the detected answer in the thread),
   the risk floor (safety for removal requests, high for chargebacks, open disputes, legal threats
   and long-term customers with an issue), the due date extracted from the message, the recipient,
   the template reference, `noKnowledgeFound` (always false while the Knowledge Base is off), the
   shape of a hand-off (no reply, no actions), the research warnings, the policy warnings
   (`policy.ts`: refund outside 30 days, refund of an older payment, second refund, deletion without
   cancellation or confirmation, cancel request proposed as immediate, vague reason without an
   ask-first reply) and, for chargebacks, the Stripe timeline attachment. Then `ProposalSchema`
   validates. Issues go back to the model; after three rejected submissions the run is `failed`, the
   ticket shows `needs_decision` with the error on `agent_runs.error` and a re-run option.
6. Write path (`store/db.ts`, one transaction): supersede the active proposal, insert the new
   version with its actions, set the ticket fields (case, confidence, risk, due date, stage, customer
   ids, context, tags, waiting_for), `researching → needs_decision`, translations of non-English
   messages into `messages.translation`. Then `autonomy.evaluate(ticketId)` and, on `auto`,
   `executor.runAuto(ticketId)`.

Triggers: `new_ticket`, `customer_reply` (detects "Yes, refund" or a change of mind, stage 2),
`case_override` (the case on the ticket is enforced), `rerun`, `follow_up`, `release_notification`
(drafts the "it's live" email from the Linear issue in `release_notifications` and the original
thread; drafted from the protocol until a "Release notification" template exists in Notion).

**Regenerate.** Every unsent reply can be drafted again from the 3-dot menu on the reply draft (or
⌘K "Regenerate the reply"): a `rerun` run that drops the editor's unsaved edits. The inbox header's
3-dot menu (or ⌘K) regenerates all unsent drafts at once after a confirm:
`POST /api/tickets/regenerate-drafts` queues one `rerun` job per ticket in `needs_decision` whose
active proposal has a reply and that has no agent run queued or running (`server/agent/regenerate.ts`;
snoozed tickets are left alone, a run would wake them). A `rerun` reads the Notion knowledge at most
`AGENT.rerunKnowledgeMaxAgeMs` (one minute) old, so a template or protocol edit shows up in the new
draft; settings are read fresh on every run anyway.

### Knowledge

`knowledge/loader.ts` reads Notion at runtime with `NOTION_TOKEN` (`@notionhq/client`, data
sources `dataSources.query`, page bodies `blocks.children.list`), caches for `AGENT.knowledgeCacheTtlMs`
(5 minutes) per process and falls back to the `docs/notion` snapshot (JSON imports plus
`knowledge/protocol-snapshot.ts`, kept identical to `customer-support.md` by a test) when the token
is missing or Notion fails. Examples: only `Status = Active` rows once the property exists. Knowledge
base: `Status = Active` and `App = InstaRadar`; Draft and Outdated entries are never loaded. The KB
is empty, so it is switched off (`KNOWLEDGE_BASE.enabled` in `shared/config.ts`, IRDR-477): it is
not queried, the prompt does not mention it, `noKnowledgeFound` stays false and the UI offers no
KB draft. Turn it on once it has Active entries.

**Hand-off (IRDR-477).** When the case is clear but no template, rule or fact says how to answer
(a specific product question, a custom deal, a request the rules do not cover), the agent keeps the
real case and submits `handoff: { reason }` with no reply and no actions (`ProposalSchema` and
`finalize.ts` enforce it; `proposals.handoff_reason` stores it). The inbox shows "Needs you", the
ticket shows the reason and a "Take over" bar; approve is refused (422 `handoff`) and autonomy
never runs it. `unclear` stays what it was: the case itself is uncertain.

### Read-only tools and credentials

| Source              | Adapter                                                                                                                                                                                                                             | Credential                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Stripe              | `tools/stripe.ts`, `stripe` SDK, reads only (customers, subscriptions, invoices, charges, refunds, disputes, events, search)                                                                                                        | `STRIPE_SECRET_KEY`                                               |
| InstaRadar database | `tools/instaradar.ts`, `pg` pool with `default_transaction_read_only=on` and `statement_timeout=8000`; whitelisted queries plus `guardSelect()` (single SELECT, no semicolons or comments, forbidden keywords, LIMIT forced to 200) | `INSTARADAR_DB_URL`                                               |
| Vercel logs         | `tools/vercel.ts`, see below                                                                                                                                                                                                        | `VERCEL_API_TOKEN` (team and project fixed in `shared/config.ts`) |
| Linear              | `tools/linear.ts`, `@linear/sdk` issue search in the team                                                                                                                                                                           | `LINEAR_API_KEY`                                                  |
| Notion              | `tools/notion.ts`, `@notionhq/client`                                                                                                                                                                                               | `NOTION_TOKEN`                                                    |
| Email history       | the store (`getPreviousTickets`) over Maelle's own tables                                                                                                                                                                           | none                                                              |
| Claude              | `model/anthropic.ts` (`messages.stream(...).finalMessage()`), `MODELS.agent` (`claude-sonnet-5-5`, `AGENT.effort` medium), consistency check `MODELS.small` (`claude-sonnet-5-5`, low effort)                                       | `ANTHROPIC_API_KEY`                                               |

Every adapter is constructed only when its variable is set; otherwise the source is `skipped`.
Tests, evals and the dev server use the fakes in the same files (`createFake*`), wired by
`createFakeTools()`.

**InstaRadar tables** were read from the InstaRadar Supabase project on 2026-09-28 and are fixed in
`shared/config.ts` (`INSTARADAR.db`): `profile` (the auth user, email, Stripe customer),
`subscription` (plan, status), `tracked_profiles` (`instagram_username`, `is_active`),
`scan_history`, `notification_log`, and `auth.audit_log_entries` for sign-ins. The read role needs
`SELECT` on those, plus `auth.users` for the last sign-in (missing grants only cost that field).

**Vercel logs.** With `VERCEL_API_TOKEN` the agent reads the Runtime Logs endpoint of the InstaRadar
project (team slug and project name in `shared/config.ts`; the project id is resolved once from the
name): `GET https://api.vercel.com/v1/projects/{projectId}/deployments/{deploymentId}/runtime-logs?slug=…`
(NDJSON, one entry per line; the production deployment id comes from
`GET /v6/deployments?projectId=…&target=production&limit=1`) and filters by time, text, user id and
profile handle. The endpoint is built for tailing and only returns a recent window. When that is not
enough, set up a Vercel **log drain** (JSON format) that posts into the `vercel_logs` table added by
`supabase/migrations/20260927010456_agent.sql` and wire `createLogDrainLogsClient` in
`server/agent/tools/index.ts` (`vercelLogsFromDrain`); the agent then queries the table with plain
SQL. The ingest route for the drain
(`POST /api/webhooks/vercel-logs`, verifying `x-vercel-signature`) belongs to the webhooks folder of
IRDR-455 and is requested from there.

**Chargeback evidence.** `attachments/stripe-timeline.ts` renders the Stripe activity timeline
deterministically as SVG (same input, same bytes) and stores it through `AttachmentStore`
(Supabase Storage bucket `attachments` in production, memory otherwise); the reply draft carries it
as `attachments[]` and the executor sends it from `storagePath`. No pure-JS SVG→PNG converter without
native dependencies is installed, so the attachment is the SVG itself; add one (or a headless
renderer) to attach a PNG.

### Consistency check

`POST /api/agent/consistency-check` (`server/agent/consistency.ts`) compares the reply text with the
enabled actions: deterministic rules (refund, cancellation, coupon, release notice, Linear ticket,
removal, deletion, retries, amounts, period-end wording, em dash) always run; with
`ANTHROPIC_API_KEY` the small model adds judgement and the results are merged.

### Evals and tests

```bash
pnpm eval                       # evals/plumbing.eval.ts: the 7 test cases + the 10 Notion examples with the
                                # ScriptedModelClient and fake tools (runs in CI). evals/live.eval.ts runs the
                                # same fixtures with the real model when ANTHROPIC_API_KEY is set, else skipped.
LIVE_EVAL_ONLY=case-3 ANTHROPIC_API_KEY=… pnpm eval   # one live fixture
pnpm test                       # tests/agent/**: credentials, knowledge, tools, two-stage, policy, context,
                                # consistency, timeline, run behaviour (retries, failure path, partial failure)
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/postgres TEST_DB_NAME=maelle_irdr456 pnpm test:db
                                # tests/db/agent/**: write path, versions, failure path, two-stage across two runs,
                                # job idempotency, translations, the agent migration
```

The eval checks case, risk, action set, stage, `requiredForReply`, confirmation stage, due date,
attachment, linked Linear issue, knowledge refs and the no-em-dash rule (`evals/harness.ts`,
`checkExpectations`). Fixtures live in `evals/fixtures/` and are shared with the unit tests.

### Dev server

`AUTH_DISABLED=true pnpm dev` without a database: `POST /api/tickets/:id/rerun` enqueues the job
and, while the jobs service is still the stub, runs the agent inline; the run then fails fast with
"Database is not configured" because the agent writes to Maelle's tables. With `SUPABASE_DB_URL`
and `ANTHROPIC_API_KEY` set, the run is real; sources without credentials are skipped with a warning.

## IRDR-460 · Claude token usage and costs

Every Claude call is recorded with its tokens and priced at the time it ran, so the cost of a
ticket, of a research step and of a period can be read from Maelle's own database.

- `public.model_calls`: one row per API call. `purpose` is `agent_turn` (one row per turn of the
  agent loop, with `run_id`, `turn` and `attempt`), `consistency_check` (the small model behind the
  reply editor), `kb_condensation` (Create KB draft), `history_classification` (the classify-only
  pass over imported history tickets) or `eval`. Columns: the four token kinds as the
  API reports them (`input_tokens` uncached, `cache_read_tokens`, `cache_creation_tokens`,
  `output_tokens`), `cost_usd`, `duration_ms`, `status` (`ok`, `refusal`, `error`), `stop_reason`.
- `public.agent_tool_calls`: one row per tool call inside the loop: tool, source, input, result size,
  duration, and `context_tokens`, the share of the next turn's input growth this result caused
  (measured; `context_measured = false` marks the `result_chars / 4` estimate written when no next
  turn came). Every later turn reads those tokens again, which is why a large tool result costs more
  than its own size.
- `public.agent_runs` keeps the totals of the latest attempt (`input_tokens` is uncached input since
  this migration; `cache_read_tokens`, `cache_creation_tokens`, `cost_usd`), on success and on failure.

Recording goes through `server/usage/` (`UsageSink`: Postgres or memory) and `trackModelCall()`,
which wraps a call, reads `response.usage` and writes the row; a sink error is logged and never
fails the call. Prices live in `shared/pricing.ts` (USD per million tokens per model, incl. cache
reads and 5-minute cache writes); a model without a price records `cost_usd = null` and the UI shows
tokens only. Update that table when a price or a model changes: the history keeps the price of its
day.

Where it shows: the ticket detail's Research meta line (`3 sources · 22s · $0.42`, the run that
produced the proposal) with "Show cost breakdown" (every run with its turns and tool calls, the
consistency checks and KB drafts, the ticket total), and the Costs page (`/anastasai/costs`,
`GET /api/usage?days=30`): spend, per ticket, calls and cache share, cost per day, by purpose and
model, the tools with their context tokens and durations, the most expensive tickets. The
aggregation is one pure function (`shared/usage.ts`) fed by the database rows or by the seed, so
`AUTH_DISABLED=true pnpm dev` shows the page with sample data. The live eval prints tokens and USD
per fixture.

## Mail and jobs (IRDR-455)

Every mail to support@instaradar.app becomes a ticket, every reply goes out exactly once, and one
job runner drives all scheduled work. Design and reasons: `docs/adr/001-jobs.md`.

### How it runs

- `POST|GET /api/cron/tick` every minute (Vercel Cron, `vercel.json`): evaluates the recurring
  schedule from `job_heartbeats`, runs due jobs from the `jobs` table within `JOBS.tickBudgetMs`,
  checks health, prunes old history once a day.
- `POST|GET /api/cron/fetch-mail` every minute: the `fetch_mail` lane, so a long agent run never
  delays inbound mail.
- `POST /api/webhooks/linear`: a completed issue of the InstaRadar team creates one
  `release_notification` ticket per stored customer email and enqueues the agent.
- Handlers: `services.jobs.registerHandler(type, handler)`. This ticket registers `fetch_mail`,
  `wake_snoozed`, `waiting_follow_up` and `send_system_email`; the agent registers `agent_run`, the
  executor `run_due_scheduled`, autonomy `daily_digest`. A job without a handler waits and is
  retried a minute later (logged, never dropped).
- Enqueue: `services.jobs.enqueue(type, payload, runAt?)`. Inbound mail, the timers and the webhook
  enqueue `agent_run` with a dedupe key, so the same event never produces two runs.
- Sending: `services.mail.sendReply(ticketId, draft, { sentBy, idempotencyKey })`. Pass the
  execution id as `idempotencyKey`; a retry returns the stored result without sending. The reply
  carries `In-Reply-To`/`References` of the latest customer mail, the thread's subject with `Re:`,
  plain text plus simple HTML, and attachments from Storage. `services.mail.sendSystemEmail(to,
subject, body)` goes to `OWNER.notifyEmail` when `to` is empty. Every reply gets Anastasia's
  signature (`MAILBOX.signature`) appended when it is sent, with her photo inline in the HTML part
  (`server/mail/signature-photo.ts`); drafts carry no sign-off.
- Follow-ups: `shared/follow-up.ts` `followUpKindDue()` decides between `follow_up` (after
  `settings.follow_up_days`) and `auto_close` (after `settings.auto_close_days`), counted from our
  first reply after the customer's last message. The agent can read the latest
  `ticket_follow_ups` row of a ticket to see which one a `follow_up` run is for.
- Tables added: `jobs`, `job_runs`, `job_heartbeats`, `mail_cursors`, `mail_sends`, `mail_ignored`,
  `ticket_follow_ups`; columns `messages.text_stripped`, `messages.provider_thread_id`,
  `messages.headers`.

### The mailbox

support@instaradar.app is hosted on Namecheap Private Email: IMAP `mail.privateemail.com:993` in,
SMTP `mail.privateemail.com:465` out, login is the address. Hosts, ports, the sender name
("Anastasia at InstaRadar") and the signature are fixed in `shared/config.ts` (`MAILBOX`); the one secret
is `MAIL_PASSWORD`, the mailbox password used for both. The cursor is the INBOX UID; sent mail is
appended to the Sent folder (found through the `\Sent` special-use flag), so replies show up in
Apple Mail like any other. Without `MAIL_PASSWORD` the in-memory fake is used, which is also what
the tests use; for a local end-to-end run set `MAIL_FAKE_DIR=.data/mail` and drop `.eml` files there
(names sort chronologically, e.g. `2026-09-27T10-00-mail.eml`); sent mail is written to
`.data/mail/sent`.

Inbound rules: dedupe by `Message-ID` (and provider id); auto-replies (`Auto-Submitted` other than
`no`, `Precedence: auto_reply`, `X-Autoreply`, out-of-office subjects), bounces (mailer-daemon,
delivery-status reports, empty `Return-Path`), bulk mail (`Precedence: bulk|junk|list`, list
headers) and our own mail never become tickets (see `mail_ignored`). Threading: `In-Reply-To` /
`References`, then the provider thread id, then same sender + same normalised subject within 30
days. A customer reply moves `waiting_on_customer`, `closed`, `snoozed` and `needs_decision` to
`researching` and enqueues a `customer_reply` run; a reply on a `new` ticket is attached to the
queued run; other statuses attach and enqueue a run without changing the status.

### Mailbox menu: fetch now, history import, cases for old tickets

The inbox header has a **Mailbox** popover (`/api/mail/status`, `InboxMailboxMenu.vue`) with the
live fetch state and three actions:

- **Fetch now** (`POST /api/mail/fetch`) runs the live fetch in the request and reports what it
  found. Safe next to the cron's own run: every message deduplicates.
- **Import history** (`POST /api/mail/import`, `server/mail/backfill.ts`) loads everything that is
  in INBOX and in the Sent folder, oldest first, so the closed view holds every conversation from
  before Maelle and the per-case counts cover them. It is not the live fetch: every ticket it
  creates is **closed on arrival** with `tickets.imported_at` set, **no agent run is ever enqueued**,
  and the 30-day subject window is measured from each mail's own date on both sides. Our old replies
  come from the Sent folder as outbound messages sent by you (threaded by `In-Reply-To`, else by
  recipient and subject within 30 days; a mail we sent first opens its own closed ticket; mail to our
  own domain is ignored). Work happens in `backfill_mail` chunk jobs (`MAILBOX.backfill` in
  `shared/config.ts`: 50 messages, 25 s) that run in the fetch-mail lane next to the live fetch and
  re-enqueue themselves until both folders are done; the cursor (`mail_backfills`, one row per
  folder) only moves past handled mail, a failed message is counted and skipped, and a chunk that
  dies is simply run again. A customer who writes to an imported thread reopens it the normal way.
- **Classify** (`POST /api/mail/classify-imported`, `server/mail/history-classify.ts`) gives imported
  tickets a case without drafting or executing anything: one short call per ticket on
  `MODELS.classify` (`claude-sonnet-5-5`, low effort, JSON schema, the same `unclear` threshold as
  the agent), in `classify_imported` chunk jobs. It starts by itself when an import finishes and
  needs `ANTHROPIC_API_KEY`; attempts per ticket live in `ticket_classifications`, and after three
  failures a ticket is left without a case instead of retrying forever.

The closed table's case filter shows the count per case under the current decision and date
filters (`caseCounts` on `GET /api/tickets?status=closed`), imported history included; imported rows
show "Imported" in the decision column.

Migration `20260929120000_mail_history.sql` also seeds the InstaRadar `apps` row and its `settings`
row: a fresh project never ran `pnpm db:seed` (that carries the design's sample tickets), and
without the app row the first real customer mail fails to ingest.

### Linear webhook

Linear → Settings → API → Webhooks → new webhook with URL `https://<maelle>/api/webhooks/linear`,
resource "Issues", team InstaRadar. Put the signing secret into `LINEAR_WEBHOOK_SECRET` and the
team (id and key `IRDR`) is fixed in `shared/config.ts`. The signature is HMAC-SHA256 of
the raw body; deliveries older than five minutes are rejected; retries are idempotent.

### Deploying the crons

`vercel.json` schedules both routes every minute. Set `CRON_SECRET` in the Vercel project (Vercel
sends it as `Authorization: Bearer ...`). Per-minute crons need the Pro plan (Hobby allows daily
crons only) and the cron function needs a max duration of 300 s: `nuxt.config.ts` sets
`nitro.vercel.functions.maxDuration = 300` (raise it on Pro if a tick regularly runs out of budget,
and keep `JOBS.tickBudgetMs` below it). If Vercel Cron is not an option, Supabase `pg_cron` + `pg_net` can
call the same URLs; the SQL is in the ADR.

### Trying it locally

```bash
AUTH_DISABLED=true CRON_SECRET=dev SUPABASE_DB_URL=postgresql://postgres@127.0.0.1:54329/maelle_irdr455 pnpm dev --port 3001
curl -s -X POST -H 'Authorization: Bearer dev' localhost:3001/api/cron/fetch-mail | jq
curl -s -X POST -H 'Authorization: Bearer dev' localhost:3001/api/cron/tick | jq
```

Tests: `pnpm test` covers parsing (multipart, HTML only, forwarded, non-English, auto-reply, bounce,
attachment), classification, quote stripping, threading, MIME composition, provider selection,
schedule slots, backoff and the webhook signature. `TEST_DATABASE_URL=... TEST_DB_NAME=maelle_irdr455
pnpm test:db` covers the pipeline end to end on a real Postgres: ingest and dedupe, threading and
status transitions, ignored mail, attachments, a crash mid-ingest, exactly-once sends (retry,
send-then-crash, stale lock takeover, concurrency), enqueue/claim/retry/dead-letter, expired locks,
per-ticket serialisation, the recurring schedule, snooze wake-up, follow-up timers, health alerts,
the Linear webhook, both cron lanes, the history import (both folders, chunk cursors, the
classify-only pass, the lanes running it) and the mailbox status.
