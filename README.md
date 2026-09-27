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

## IRDR-456 · AnastasAI agent run

`server/agent/` turns one ticket into one validated proposal: case, research with sources, actions
from the registry, reply draft. The agent reads everything and writes nothing outside Maelle's own
tables; that is enforced by construction, not by the prompt. `tests/agent/credentials.test.ts`
proves the module tree never references a write credential name and never imports the executor, and
that the agent's config accessor (`server/agent/config.ts`, the only place that reads the
environment) exposes read keys only.

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
   Notion protocol, the 17 templates, the examples, the knowledge base and the action registry
   (cached with `cache_control`); user message with the thread, the research bundle, the facts and
   hints. Read-only tools: `stripe_events`, `stripe_search_customers`, `stripe_retrieve`,
   `instaradar_select` (one guarded SELECT), `instaradar_profile`, `vercel_logs`, `linear_search`,
   `notion_page`, `email_history`. Output only through `submit_proposal`.
5. `finalize.ts` owns what must not depend on the model: the confirmation stage
   (`customerConfirmationNeeded` follows the template plus the detected answer in the thread),
   the risk floor (safety for removal requests, high for chargebacks, open disputes, legal threats
   and long-term customers with an issue), the due date extracted from the message, the recipient,
   the template reference, `noKnowledgeFound`, the research warnings, the policy warnings
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

### Knowledge

`knowledge/loader.ts` reads Notion at runtime with `NOTION_READ_TOKEN` (`@notionhq/client`, data
sources `dataSources.query`, page bodies `blocks.children.list`), caches for `KNOWLEDGE_CACHE_TTL_MS`
(5 minutes) per process and falls back to the `docs/notion` snapshot (JSON imports plus
`knowledge/protocol-snapshot.ts`, kept identical to `customer-support.md` by a test) when the token
is missing or Notion fails. Examples: only `Status = Active` rows once the property exists. Knowledge
base: `Status = Active` and `App = InstaRadar`; Draft and Outdated entries are never loaded. The KB
is empty at snapshot time, so `noKnowledgeFound` is true for most cases until it is filled.

### Read-only tools and credentials

| Source              | Adapter                                                                                                                                                                                                                             | Credential                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Stripe              | `tools/stripe.ts`, `stripe` SDK, reads only (customers, subscriptions, invoices, charges, refunds, disputes, events, search)                                                                                                        | `STRIPE_READ_KEY`                                                    |
| InstaRadar database | `tools/instaradar.ts`, `pg` pool with `default_transaction_read_only=on` and `statement_timeout=8000`; whitelisted queries plus `guardSelect()` (single SELECT, no semicolons or comments, forbidden keywords, LIMIT forced to 200) | `INSTARADAR_DB_READ_URL`                                             |
| Vercel logs         | `tools/vercel.ts`, see below                                                                                                                                                                                                        | `VERCEL_API_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_INSTARADAR_PROJECT_ID` |
| Linear              | `tools/linear.ts`, `@linear/sdk` issue search in the team                                                                                                                                                                           | `LINEAR_READ_API_KEY`, `LINEAR_TEAM_ID`                              |
| Notion              | `tools/notion.ts`, `@notionhq/client`                                                                                                                                                                                               | `NOTION_READ_TOKEN`                                                  |
| Email history       | the store (`getPreviousTickets`) over Maelle's own tables                                                                                                                                                                           | none                                                                 |
| Claude              | `model/anthropic.ts` (`messages.stream(...).finalMessage()`), `AGENT_MODEL` default `claude-fable-5-1`, consistency check `AGENT_SMALL_MODEL` default `claude-sonnet-5`                                                             | `ANTHROPIC_API_KEY`                                                  |

Every adapter is constructed only when its variable is set; otherwise the source is `skipped`.
Tests, evals and the dev server use the fakes in the same files (`createFake*`), wired by
`createFakeTools()`.

**InstaRadar table names** are assumptions (the InstaRadar repository was not reachable):
`public.profiles`, `public.tracked_profiles`, `public.scans`, `public.alerts`,
`auth.audit_log_entries`, `public.blocked_profiles` with the columns listed in
`DEFAULT_INSTARADAR_TABLES` (`server/agent/config.ts`). Override any of them with the
`INSTARADAR_TABLES` JSON.

**Vercel logs.** `VERCEL_LOGS_SOURCE=api` (default) reads the Runtime Logs endpoint
`GET https://api.vercel.com/v1/projects/{projectId}/deployments/{deploymentId}/runtime-logs?teamId=…`
(NDJSON, one entry per line; the production deployment id comes from
`GET /v6/deployments?projectId=…&target=production&limit=1`) and filters by time, text, user id and
profile handle. The endpoint is built for tailing and only returns a recent window. When that is not
enough, set up a Vercel **log drain** (JSON format) that posts into the `vercel_logs` table added by
`supabase/migrations/20260927010456_agent.sql` and set `VERCEL_LOGS_SOURCE=drain`; the agent then
queries the table with plain SQL (`createLogDrainLogsClient`). The ingest route for the drain
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
