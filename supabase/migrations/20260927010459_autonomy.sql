-- IRDR-459: autonomy audit trail, notification log, learning loop. Additive only.

-- ---------------------------------------------------------------- settings_audit (every change on the Autonomy page)

create table if not exists public.settings_audit (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  -- the session email that made the change
  changed_by text not null,
  scope text not null check (scope in ('setting','mode','lock')),
  -- settings column (camelCase key), case type or action type
  key text not null,
  old_value jsonb,
  new_value jsonb,
  -- "Cancellation only: Always ask → Auto"
  summary text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists settings_audit_created_idx on public.settings_audit (app_id, created_at desc);

-- ---------------------------------------------------------------- notifications (alerts and digests that went out, with dedupe)

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  app_id uuid references public.apps(id) on delete cascade,
  kind text not null check (kind in ('high_risk_ticket','daily_digest','system_alert')),
  -- high_risk_ticket: the ticket id (one alert per ticket); daily_digest: the local date
  dedupe_key text,
  ticket_id uuid references public.tickets(id) on delete set null,
  recipient text,
  subject text not null default '',
  body text not null default '',
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  error text,
  -- digest: { since, until, counts }
  meta jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists notifications_dedupe_key on public.notifications (kind, dedupe_key) where dedupe_key is not null;
create index if not exists notifications_kind_created_idx on public.notifications (kind, created_at desc);

-- ---------------------------------------------------------------- learning_events (pages created in Notion from a ticket)

create table if not exists public.learning_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  kind text not null check (kind in ('example','kb_draft')),
  notion_page_id text not null,
  notion_url text not null,
  created_by text,
  created_at timestamptz not null default now(),
  unique (ticket_id, kind)
);

-- Undo counts on the Autonomy page: Auto executions cancelled inside the undo window.
create index if not exists action_executions_auto_cancelled_idx on public.action_executions (ticket_id)
  where executed_by = 'auto' and status = 'cancelled';

-- ---------------------------------------------------------------- RLS: only the allowed user (service role bypasses)

do $$
declare
  t text;
begin
  foreach t in array array['settings_audit','notifications','learning_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists allowed_user_all on public.%I', t);
    execute format(
      'create policy allowed_user_all on public.%I for all to authenticated using (public.is_allowed_user()) with check (public.is_allowed_user())',
      t
    );
  end loop;
end $$;
