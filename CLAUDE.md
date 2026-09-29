# CLAUDE.md

Maelle is the AI business superbrain for running InstaRadar; the first area is AnastasAI (customer
support). `README.md` is the source of truth for the architecture, folder ownership and the binding
contracts in `shared/` — read it before touching more than one folder.

## Browser verification — only on request

- Do NOT verify changes in a browser by default (chrome-devtools MCP,
  screenshots, `pnpm screenshot`, scripted page interactions, driving the dev
  server). It eats too many tokens relative to the value.
- Only run browser/visual verification when explicitly asked (e.g. "verify",
  "check it in the browser", "screenshot it").
- Cheap non-browser checks stay fine without asking: grep/read the code, run a
  targeted curl against an API route, query the local DB, run `pnpm typecheck`,
  `pnpm lint`, `pnpm test`, `pnpm test:db`.

## Git Workflow

- There is no `develop` branch: feature branches come off `main`. Always pull
  the latest `main` before branching off it
- Branch naming: use the exact Linear ticket ID as prefix,
  e.g. `irdr-460-fix-ticket-reply-recipient`
- Always fetch the exact branch name from Linear MCP and use it as-is — rename the branch if the name doesn't match
- Set the Linear ticket to "In Progress" when you start working on it
- Never commit directly to `main`

## Worktree Workflow

- Always work in an isolated git worktree
- When starting a new task, run in terminal: `claude --worktree <branch-name>`
- Never work directly in the main checkout
- After creating a new worktree, symlink the main checkout's `.env` so the
  worktree picks up the Supabase / mailbox / Anthropic / Stripe keys (run from
  the worktree root):

  ```sh
  ln -s ../../../.env .env
  ```

  The `.env` symlink target is gitignored. Without it the server runs against
  the in-memory fakes and stubbed routes (see `.env.example`).
- `node_modules` is not shared with the main checkout: run `pnpm install` in
  the worktree before `pnpm dev` (the `postinstall` runs `nuxt prepare`).
- After a feature PR is merged, remove the worktree to avoid disk bloat and
  stray watcher load on subsequent dev sessions:

  ```sh
  git worktree remove .claude/worktrees/<branch-name>
  git branch -D <branch-name>  # optional: drop the local branch too
  ```

## Commit Messages

- Follow Conventional Commits format
- Always append the Linear ticket ID in parentheses
- Examples:
  - `fix: pin the reply recipient to the original sender (IRDR-457)`
  - `feat: show the track record on the autonomy page (IRDR-459)`

## Database access

- Server code reads and writes Maelle's own database through
  `server/utils/db.ts` (`dbQuery`, `dbOne`, `withTransaction`: a `pg` pool on
  `SUPABASE_DB_URL` / `POSTGRES_URL`). Write plain SQL with `$1` params; the same
  SQL runs in `pnpm test:db` against a local Postgres, so every query is
  testable without a Supabase project.
- `useServiceDb()` (supabase-js, service role) is only for Storage and Auth
  admin calls. Don't route table reads through it.
- Anything that does go through the Data API (supabase-js in `app/`, e.g.
  Realtime) is subject to PostgREST's `max_rows = 1000`
  (`supabase/config.toml`): an unbounded read is silently truncated. Paginate
  or keep such reads bounded.
- The InstaRadar database is a separate project reached via
  `INSTARADAR_DB_URL`. The agent reads it, only the executor writes it
  (`server/executor/clients/instaradar.ts`); table names live in
  `shared/config.ts` (`INSTARADAR.db`). The agent's module tree must never
  import the executor (a test enforces it).
- Routes fall back to the seed data when no database is configured
  (`isDbConfigured()`), so the UI keeps working offline. Keep that path alive.

## Shared contracts

- Changes to `shared/` are additive only (new fields, tables, migrations —
  never renames or removals). The binding contracts are listed in
  `README.md` → "Binding contracts (do not rename)".
- `shared/status.ts` `transition(from, to)` is the only way to change a ticket
  status; `shared/actions.ts` is the action registry; `shared/proposal.ts` is
  the agent's output contract.
- Nothing changes external state without approval, enforced by the system:
  the agent has no write credentials, the executor is the only code that
  changes anything, and the server never trusts the UI.

## Session
- When starting a new chat for a Linear ticket, set the chat window title to: [IRDR-XXX] Ticket heading

## Skills
@.claude/skills/ui-components/SKILL.md
@.claude/skills/create-pr/SKILL.md
@.claude/skills/supabase-migration/SKILL.md
@.claude/skills/troubleshooting/SKILL.md
