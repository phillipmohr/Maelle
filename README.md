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

## Mail and jobs (IRDR-455)

Every mail to support@instaradar.app becomes a ticket, every reply goes out exactly once, and one
job runner drives all scheduled work. Design and reasons: `docs/adr/001-jobs.md`.

### How it runs

- `POST|GET /api/cron/tick` every minute (Vercel Cron, `vercel.json`): evaluates the recurring
  schedule from `job_heartbeats`, runs due jobs from the `jobs` table within `JOBS_TICK_BUDGET_MS`,
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
subject, body)` goes to `NOTIFY_EMAIL` when `to` is empty.
- Follow-ups: `shared/follow-up.ts` `followUpKindDue()` decides between `follow_up` (after
  `settings.follow_up_days`) and `auto_close` (after `settings.auto_close_days`), counted from our
  first reply after the customer's last message. The agent can read the latest
  `ticket_follow_ups` row of a ticket to see which one a `follow_up` run is for.
- Tables added: `jobs`, `job_runs`, `job_heartbeats`, `mail_cursors`, `mail_sends`, `mail_ignored`,
  `ticket_follow_ups`; columns `messages.text_stripped`, `messages.provider_thread_id`,
  `messages.headers`.

### Which mail provider

The mailbox host decides the adapter. Run `dig MX instaradar.app` (or `nslookup -type=MX
instaradar.app`):

- MX records pointing to `*.google.com` / `*.googlemail.com`: Google Workspace. Use
  `MAIL_PROVIDER=gmail` with either an OAuth client of the mailbox (Google Cloud project, Gmail API
  enabled, OAuth client "Desktop app", one-time consent with scope
  `https://www.googleapis.com/auth/gmail.modify` to obtain `GMAIL_OAUTH_REFRESH_TOKEN`), or a
  service account with domain-wide delegation for that scope (`GMAIL_SERVICE_ACCOUNT_JSON`,
  `GMAIL_IMPERSONATE_USER=support@instaradar.app`). The cursor is the mailbox history id; replies
  are sent through the API into the same thread and land in Sent automatically.
- Anything else (Zoho, Fastmail, Namecheap, Hetzner, ...): `MAIL_PROVIDER=imap` with
  `IMAP_HOST/IMAP_PORT/IMAP_USER/IMAP_PASSWORD` and `SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD`
  (usually the same login; use an app password when 2FA is on). The cursor is the INBOX UID; sent
  mail is appended to the Sent folder (`IMAP_SENT_FOLDER` if it cannot be detected).
- No credentials: the in-memory fake, which is also what the tests use. For a local end-to-end
  run set `MAIL_FAKE_DIR=.data/mail` and drop `.eml` files there (names sort chronologically, e.g.
  `2026-09-27T10-00-mail.eml`); sent mail is written to `.data/mail/sent`.

Inbound rules: dedupe by `Message-ID` (and provider id); auto-replies (`Auto-Submitted` other than
`no`, `Precedence: auto_reply`, `X-Autoreply`, out-of-office subjects), bounces (mailer-daemon,
delivery-status reports, empty `Return-Path`), bulk mail (`Precedence: bulk|junk|list`, list
headers) and our own mail never become tickets (see `mail_ignored`). Threading: `In-Reply-To` /
`References`, then the provider thread id, then same sender + same normalised subject within 30
days. A customer reply moves `waiting_on_customer`, `closed`, `snoozed` and `needs_decision` to
`researching` and enqueues a `customer_reply` run; a reply on a `new` ticket is attached to the
queued run; other statuses attach and enqueue a run without changing the status.

### Linear webhook

Linear → Settings → API → Webhooks → new webhook with URL `https://<maelle>/api/webhooks/linear`,
resource "Issues", team InstaRadar. Put the signing secret into `LINEAR_WEBHOOK_SECRET` and the
team into `LINEAR_TEAM_ID` (or `LINEAR_TEAM_KEY`, default `IRDR`). The signature is HMAC-SHA256 of
the raw body; deliveries older than five minutes are rejected; retries are idempotent.

### Deploying the crons

`vercel.json` schedules both routes every minute. Set `CRON_SECRET` in the Vercel project (Vercel
sends it as `Authorization: Bearer ...`). Per-minute crons need the Pro plan (Hobby allows daily
crons only) and the cron function needs a max duration of 300 s (Vercel Fluid compute default; if
the project is configured differently, set `nitro.vercel.functions.maxDuration = 300` in
`nuxt.config.ts` or the function max duration in the Vercel dashboard, and keep
`JOBS_TICK_BUDGET_MS` below it). If Vercel Cron is not an option, Supabase `pg_cron` + `pg_net` can
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
the Linear webhook and both cron lanes.
