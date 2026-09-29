-- IRDR-460 Claude token usage. Additive only.
--
-- 1. model_calls: one row per Claude API call (agent turns, consistency checks, KB condensations,
--    the classify-only pass over imported history, evals) with the four token kinds, the cost at
--    the time of the call and the duration.
-- 2. agent_tool_calls: one row per tool call inside the agent loop, with the size of its result and
--    its share of the context growth measured on the following turn.
-- 3. agent_runs: cache and cost totals of the latest attempt, written on success and on failure.
--    From now on agent_runs.input_tokens holds the uncached input tokens only (as the API reports
--    them); the cache tokens have their own columns. Older rows keep their summed value and null
--    cache columns.

-- ---------------------------------------------------------------- model_calls

create table if not exists public.model_calls (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.tickets(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete set null,
  purpose text not null check (purpose in ('agent_turn','consistency_check','kb_condensation','history_classification','eval')),
  model text not null,
  -- 1-based turn inside the agent loop; null for single calls
  turn integer,
  -- agent_runs.attempt at the time of the call
  attempt integer,
  status text not null default 'ok' check (status in ('ok','refusal','error')),
  stop_reason text,
  error text,
  input_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_creation_tokens integer not null default 0,
  output_tokens integer not null default 0,
  -- priced with shared/pricing.ts when the call was recorded; null for an unknown model
  cost_usd numeric(12,6),
  duration_ms integer,
  created_at timestamptz not null default now()
);

comment on table public.model_calls is 'One row per Claude API call: tokens, cache share, cost at call time and duration (IRDR-460).';

create index if not exists model_calls_ticket_idx on public.model_calls (ticket_id, created_at desc);
create index if not exists model_calls_run_idx on public.model_calls (run_id);
create index if not exists model_calls_created_idx on public.model_calls (created_at desc);

-- ---------------------------------------------------------------- agent_tool_calls

create table if not exists public.agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.agent_runs(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete cascade,
  -- the turn whose response asked for this tool
  model_call_id uuid references public.model_calls(id) on delete set null,
  turn integer not null,
  tool text not null,
  -- progress source (stripe, supabase, vercel, kb, linear, email); null for submit_proposal
  source text,
  ok boolean not null default true,
  input jsonb not null default '{}'::jsonb,
  result_chars integer not null default 0,
  -- tokens the result added to the context: estimated from result_chars at insert time, replaced
  -- by the measured share of the next turn's input growth (context_measured = true)
  context_tokens integer,
  context_measured boolean not null default false,
  duration_ms integer,
  created_at timestamptz not null default now()
);

comment on table public.agent_tool_calls is 'One row per tool call in the agent loop: input, result size, context tokens and duration (IRDR-460).';

create index if not exists agent_tool_calls_run_idx on public.agent_tool_calls (run_id, turn);
create index if not exists agent_tool_calls_ticket_idx on public.agent_tool_calls (ticket_id);
create index if not exists agent_tool_calls_tool_idx on public.agent_tool_calls (tool, created_at desc);

-- ---------------------------------------------------------------- agent_runs totals

alter table public.agent_runs add column if not exists cache_read_tokens integer;
alter table public.agent_runs add column if not exists cache_creation_tokens integer;
alter table public.agent_runs add column if not exists cost_usd numeric(12,6);

comment on column public.agent_runs.input_tokens is 'Uncached input tokens of the latest attempt (cache tokens have their own columns). Rows before IRDR-460 hold the sum of all input kinds.';

-- ---------------------------------------------------------------- Data API access (required from 2026-10-30 onward)

grant select, insert, update, delete on public.model_calls to authenticated;
grant select, insert, update, delete on public.model_calls to service_role;
grant select, insert, update, delete on public.agent_tool_calls to authenticated;
grant select, insert, update, delete on public.agent_tool_calls to service_role;

-- ---------------------------------------------------------------- RLS: only the allowed user (service role bypasses)

do $$
declare
  t text;
begin
  foreach t in array array['model_calls','agent_tool_calls'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists allowed_user_all on public.%I', t);
    execute format(
      'create policy allowed_user_all on public.%I for all to authenticated using (public.is_allowed_user()) with check (public.is_allowed_user())',
      t
    );
  end loop;
end $$;
