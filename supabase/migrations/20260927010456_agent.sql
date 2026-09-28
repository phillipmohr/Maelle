-- IRDR-456 agent. Additive only.
--
-- 1. agent_runs.job_id / attempt: one run per job (idempotent job handler; a retried job reuses its row).
-- 2. vercel_logs: the queryable store for an optional Vercel log drain (README, "Vercel logs").

alter table public.agent_runs add column if not exists job_id text;
alter table public.agent_runs add column if not exists attempt integer not null default 1;
create unique index if not exists agent_runs_job_id_key on public.agent_runs (job_id) where job_id is not null;

create table if not exists public.vercel_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null,
  level text not null default 'info',
  source text,
  message text not null,
  request_id text,
  deployment_id text,
  raw jsonb,
  created_at timestamptz not null default now()
);

comment on table public.vercel_logs is 'InstaRadar runtime logs posted by a Vercel log drain (JSON format). Read by the agent when the log drain adapter is wired in (server/agent/tools/index.ts).';

create index if not exists vercel_logs_at_idx on public.vercel_logs (at desc);

alter table public.vercel_logs enable row level security;
drop policy if exists allowed_user_all on public.vercel_logs;
create policy allowed_user_all on public.vercel_logs
  for all to authenticated
  using (public.is_allowed_user())
  with check (public.is_allowed_user());
