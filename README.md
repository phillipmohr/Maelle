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
