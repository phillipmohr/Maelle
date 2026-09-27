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
proposal has no policy warnings, no customer confirmation is pending (stage 1), and no enabled action
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
Examples and Knowledge Base counts (live through `NOTION_READ_TOKEN`, cached five minutes; snapshot
counts otherwise, `liveCounts` says which).

### Notifications

`services.notify(kind, payload)` sends plain-text mail to `settings.notify_email`, else
`NOTIFY_EMAIL`, through `services.mail.sendSystemEmail`, and logs every attempt in `notifications`
(`pending`, `sent`, `failed`, `skipped`). `high_risk_ticket` is deduped per ticket, `daily_digest`
per local day (`digest:YYYY-MM-DD` in the settings timezone), `system_alert` always sends. The
`daily_digest` job handler is registered in `server/plugins/autonomy.ts`; the digest covers
everything since the last sent digest: handled automatically, needs a decision, waiting, failed actions.

### Learning loop

- Notion writes go through `NotionWriter` (`server/learning/notion-writer.ts`): the real adapter uses
  `NOTION_WRITE_TOKEN` (insert only), the in-memory fake serves tests and every environment without
  the token. Claude calls go through `ModelClient` (`ANTHROPIC_API_KEY`, `AGENT_SMALL_MODEL`, default
  `claude-sonnet-5`) with a deterministic fallback (first sentences of the reply).
- `POST /api/learning/example { ticketId }`: Draft page in the Examples DB (Name, Category, Customer
  message, Response, Status Draft). `POST /api/learning/kb-draft { ticketId }`: Draft page in the
  Knowledge Base (Name, Category, Type, Customer phrasing, Short answer, App InstaRadar, Status Draft,
  Related templates). Both return `{ notionPageId, url }`, are idempotent per ticket
  (`learning_events`), and need the ticket from the database (503 offline).
- The Examples data source got a `Status` select (Active, Draft) on 2026-09-27; the existing 10
  examples are Active. New examples arrive as Draft and are only used once Phillip sets them to Active.

### Tests

```bash
pnpm test                                        # tests/autonomy: rules, evaluate guards, notify, activity, learning
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/postgres TEST_DB_NAME=maelle_irdr459 pnpm test:db
```
