---
name: supabase-migration
description: Use this skill when creating or modifying Supabase database migrations. Covers migration file creation, grant statements, the allowed-user RLS pattern, type regeneration and db tests.
---

## Supabase Migrations

- Create migration files with `pnpm exec supabase migration new "<name>"` — never hand-write the timestamp prefix. Files live in `supabase/migrations/`.
- Migrations are applied with `pnpm db:migrate` (the repo's own runner, `scripts/lib/db.ts`; it records versions in `supabase_migrations.schema_migrations`). `pnpm test:db` applies them to a local Postgres and runs `tests/db`, so every migration must also run on a plain Postgres (no Supabase-only objects without a guard — see the `supabase_realtime` publication guard in the foundation migration).
- Migrations must be idempotent (`create table if not exists`, `drop policy if exists` before `create policy`): the runner and CI apply them from scratch.
- Schema changes to shared tables are **additive only**: new columns, new tables, new migrations. Never rename or remove; status-like columns are `text` with CHECK constraints so a later migration can extend them.
- After any migration, regenerate `shared/types/database.ts` with `pnpm db:types` — easy to forget, breaks type-safety silently.
- Any new table in the `public` schema that the app reads/writes through the Data API
  (supabase-js, PostgREST `/rest/v1/`, Realtime) **must include explicit
  `GRANT` statements** in the same migration that creates the table.
  - Reason: Supabase is removing the default `public`-schema grants for the Data API
    (new projects from 2026-05-30, all existing projects from 2026-10-30). Tables
    without explicit grants will return `42501` from PostgREST.
  - Tables only ever touched through `server/utils/db.ts` (the `pg` pool) don't go through PostgREST, but grant them anyway if the UI might subscribe to them via Realtime.
- RLS pattern: Maelle has a single allowed user (`OWNER.email` in `shared/config.ts`, checked by `public.is_allowed_user()`). Every table gets one policy, `allowed_user_all`, for `authenticated`; the service role bypasses RLS. Follow the loop the existing migrations use:

```sql
create table if not exists public.example (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Data API access (required from 2026-10-30 onward)
grant select, insert, update, delete on public.example to authenticated;
grant select, insert, update, delete on public.example to service_role;

-- RLS: only the allowed user (service role bypasses)
alter table public.example enable row level security;
drop policy if exists allowed_user_all on public.example;
create policy allowed_user_all on public.example
  for all to authenticated
  using (public.is_allowed_user()) with check (public.is_allowed_user());
```

- Tables the UI should receive live updates for must be added to the `supabase_realtime` publication, guarded by `if exists (select 1 from pg_publication …)` so the migration still runs on the plain Postgres used in tests.
- Add a `tests/db` test for new constraints, policies or triggers; `pnpm test:db` runs them (needs `initdb`/`pg_ctl` locally or `TEST_DATABASE_URL`).
