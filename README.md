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

With a Supabase project:

```bash
# .env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL, ALLOWED_USER_EMAIL
pnpm db:migrate                 # applies supabase/migrations, allow-lists ALLOWED_USER_EMAIL
pnpm db:seed                    # the design's sample data (idempotent)
pnpm db:types                   # regenerates shared/types/database.ts
pnpm db:reset -- --seed         # truncate + reseed (refuses non-local URLs without --force)
```

Auth is Supabase Auth with a single allowed user: only `ALLOWED_USER_EMAIL` can sign in (magic link
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
`app/assets/fonts/`. `/dev/components` shows every shared component in every state.

Dark only. No icon set: locks, checkboxes and dots are CSS shapes. The proposal is the only lit
surface on a screen (`<Panel elevation="focus">`).

## Credentials and permissions

Every integration uses the narrowest key that can do its job. Names are in `.env.example`.

| Variable                  | Used by         | Permissions                                                                                           |
| ------------------------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| `STRIPE_READ_KEY`         | agent           | restricted key, read on everything, no writes                                                         |
| `STRIPE_WRITE_KEY`        | executor        | restricted key, write on Subscriptions, Refunds, Coupons, Promotion codes, Invoices; read on the rest |
| `INSTARADAR_DB_READ_URL`  | agent           | Postgres role with SELECT only and a statement timeout                                                |
| `INSTARADAR_DB_WRITE_URL` | executor        | Postgres role limited to the executor's writes (blocklist, deletion)                                  |
| `NOTION_READ_TOKEN`       | agent, playbook | integration with read content only                                                                    |
| `NOTION_WRITE_TOKEN`      | learning loop   | integration with read + insert content, no update or delete                                           |
| `LINEAR_READ_API_KEY`     | agent           | read                                                                                                  |
| `LINEAR_WRITE_API_KEY`    | executor        | create issues, create comments                                                                        |
| `VERCEL_API_TOKEN`        | agent           | read runtime logs of the InstaRadar project                                                           |
| `CRON_SECRET`             | cron routes     | bearer token the scheduler presents                                                                   |
| `ANTHROPIC_API_KEY`       | agent           | Claude API                                                                                            |

## Deployment

Vercel picks up the Nuxt build automatically (`pnpm build`). Set the variables from `.env.example`
in the Vercel project (preview and production). Cron schedules are added by the mail/jobs ticket
(`vercel.json` or Supabase cron, see `docs/adr/001-jobs.md`).

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

| Variable                                                          | Used for                                                    | Permissions the key or role needs                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_WRITE_KEY`                                                | cancel, refund, stop retries, coupons, cancellation details | Restricted key. **Write**: Subscriptions (`subscriptions.update`, `subscriptions.cancel`), Refunds (`refunds.create`), Coupons (`coupons.create`), Promotion codes (`promotion_codes.create`), Invoices (`invoices.update`, `invoices.mark_uncollectible`). **Read**: Customers, Charges, Payment intents, Refunds, Invoices, Subscriptions. Nothing else. Every write carries an `Idempotency-Key`. Test mode key while there is no production sign-off. |
| `INSTARADAR_DB_WRITE_URL`                                         | remove from tracking, delete account                        | Postgres role `maelle_executor` (see `docs/instaradar/executor-role.sql`): `USAGE` on the schema, `SELECT, INSERT` on `blocked_profiles`, `SELECT, DELETE` on the tracked-profiles table and on each table in `INSTARADAR_USER_TABLES`; `statement_timeout 20s`; no other grants.                                                                                                                                                                         |
| `INSTARADAR_SUPABASE_URL`, `INSTARADAR_SUPABASE_SERVICE_ROLE_KEY` | delete the InstaRadar auth user                             | The InstaRadar project's service role key (Auth admin `getUserById`, `deleteUser`). Not Maelle's own project. Alternative in `docs/instaradar/README.md` section 5.                                                                                                                                                                                                                                                                                       |
| `LINEAR_WRITE_API_KEY`, `LINEAR_TEAM_ID` or `LINEAR_TEAM_NAME`    | create issues, link existing ones                           | Personal or OAuth key with **Create issues** and **Create comments** (plus read to find the team, labels `Bug`/`Feature`, and the marker). Team InstaRadar.                                                                                                                                                                                                                                                                                               |
| `SUPABASE_DB_URL`                                                 | Maelle's own tables                                         | The pooler URL; the executor writes `action_executions`, `decisions`, `release_notifications`, `cancellation_reasons`, `tickets`, `proposals.status`.                                                                                                                                                                                                                                                                                                     |

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
pnpm test                       # tests/executor: every action against the fakes, planner, errors, clients
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/postgres TEST_DB_NAME=maelle_irdr457 pnpm test:db
```

`tests/db/executor/` clones the seeded test database into its own database per file (so the
foundation's schema assertions never race with these mutations) and runs the flows on the design's
tickets: #4824 routine approve, #4809 confirm + irreversible, #4822 stage 1, #4820 retry of a failed
required action, plus edits, partial failures, reject, manual send, snooze, mark done, case override,
Auto refusals, Auto run, undo, due scheduled sends and the refund limits.
