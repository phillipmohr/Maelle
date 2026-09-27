-- IRDR-455: mail pipeline and job runner. Additive only (new tables, new columns with defaults,
-- new indexes). The foundation migration is never edited. See docs/adr/001-jobs.md.

-- ---------------------------------------------------------------- messages: display text, provider thread, headers

alter table public.messages add column if not exists text_stripped text;
alter table public.messages add column if not exists provider_thread_id text;
alter table public.messages add column if not exists headers jsonb not null default '{}'::jsonb;

comment on column public.messages.text_stripped is 'text_body with the quoted history removed, for display. The full text stays in text_body.';
comment on column public.messages.provider_thread_id is 'Provider thread id (Gmail threadId) so a reply joins the same thread.';
comment on column public.messages.headers is 'Selected inbound headers (auto-submitted, precedence, reply-to, ...) kept for debugging.';

create index if not exists messages_in_reply_to_idx on public.messages (in_reply_to) where in_reply_to is not null;
create index if not exists messages_references_idx on public.messages using gin ("references");
create index if not exists messages_provider_thread_idx on public.messages (provider_thread_id) where provider_thread_id is not null;
create index if not exists messages_from_email_idx on public.messages (lower(from_email), created_at desc);

-- ---------------------------------------------------------------- jobs: Postgres-backed queue

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  -- queued: waiting for run_at · running: claimed (locked_at/locked_by) · succeeded
  -- failed: attempt failed; retried when attempts < max_attempts, terminal otherwise (recurring jobs)
  -- dead: attempts exhausted, dead-letter (alert sent)
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','dead')),
  run_at timestamptz not null default now(),
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts >= 1),
  -- a running job whose lock is older than this is treated as killed and re-claimed once more
  lock_ttl_seconds integer not null default 600 check (lock_ttl_seconds > 0),
  last_error text,
  locked_at timestamptz,
  locked_by text,
  -- idempotent enqueue: same key, same job (e.g. agent_run:{ticketId}:{trigger}:{messageId})
  dedupe_key text unique,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_due_idx on public.jobs (run_at) where status in ('queued','failed');
create index if not exists jobs_running_idx on public.jobs (locked_at) where status = 'running';
create index if not exists jobs_type_status_idx on public.jobs (type, status);
create index if not exists jobs_created_idx on public.jobs (created_at desc);
create index if not exists jobs_agent_run_ticket_idx on public.jobs ((payload ->> 'ticketId')) where type = 'agent_run';

drop trigger if exists jobs_set_updated_at on public.jobs;
create trigger jobs_set_updated_at before update on public.jobs
  for each row execute function public.set_updated_at();

-- one row per attempt: the visible run history
create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  attempt integer not null,
  -- expired: the worker never reported back (killed); skipped: no handler registered yet, not counted
  status text not null default 'running' check (status in ('running','succeeded','failed','expired','skipped')),
  worker text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists job_runs_job_idx on public.job_runs (job_id, attempt);
create index if not exists job_runs_started_idx on public.job_runs (started_at desc);

-- one row per recurring job: schedule slots, health and consecutive failures
create table if not exists public.job_heartbeats (
  job text primary key,
  interval_seconds integer,
  -- the schedule slot that was last claimed (minute bucket or local date); claiming is atomic on it
  last_slot text,
  last_scheduled_at timestamptz,
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  consecutive_failures integer not null default 0,
  last_error text,
  last_alert_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- mail: fetch cursor, exactly-once sends, ignored inbound

create table if not exists public.mail_cursors (
  mailbox text primary key,
  provider text not null check (provider in ('gmail','imap','fake')),
  -- Gmail: historyId · IMAP: last UID (uidValidity in cursor_meta) · fake: count
  cursor text,
  cursor_meta jsonb not null default '{}'::jsonb,
  last_fetch_at timestamptz,
  -- summary of the last fetch run ({ fetched, ingested, skipped, ignored, ticketsCreated, reset })
  last_result jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.mail_sends (
  idempotency_key text primary key,
  ticket_id uuid references public.tickets(id) on delete set null,
  kind text not null check (kind in ('reply','system')),
  -- sending: in flight (a stale row is taken over after a timeout, after asking the provider first)
  status text not null default 'sending' check (status in ('sending','sent','failed')),
  attempts integer not null default 1,
  to_emails text[] not null default '{}',
  subject text,
  -- generated before the provider call, so a retry can find a mail that was sent but not recorded
  rfc_message_id text not null,
  provider_message_id text,
  message_row_id uuid references public.messages(id) on delete set null,
  last_error text,
  started_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mail_sends_ticket_idx on public.mail_sends (ticket_id, created_at desc);
create index if not exists mail_sends_status_idx on public.mail_sends (status, started_at);

drop trigger if exists mail_sends_set_updated_at on public.mail_sends;
create trigger mail_sends_set_updated_at before update on public.mail_sends
  for each row execute function public.set_updated_at();

-- inbound mail that never became a message (auto-replies, bounces, bulk, our own mail)
create table if not exists public.mail_ignored (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text,
  message_id text,
  reason text not null,
  from_email text,
  subject text,
  received_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists mail_ignored_message_id_key on public.mail_ignored (message_id) where message_id is not null;
create index if not exists mail_ignored_created_idx on public.mail_ignored (created_at desc);

-- ---------------------------------------------------------------- follow-up timers (waiting_on_customer)

create table if not exists public.ticket_follow_ups (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  kind text not null check (kind in ('follow_up','auto_close')),
  -- start of the waiting period: our first reply after the customer's last message
  waiting_since timestamptz not null,
  job_id uuid references public.jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (ticket_id, kind, waiting_since)
);

create index if not exists ticket_follow_ups_ticket_idx on public.ticket_follow_ups (ticket_id, created_at desc);

-- ---------------------------------------------------------------- RLS: only the allowed user (service role bypasses)

do $$
declare
  t text;
begin
  foreach t in array array[
    'jobs','job_runs','job_heartbeats','mail_cursors','mail_sends','mail_ignored','ticket_follow_ups'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists allowed_user_all on public.%I', t);
    execute format(
      'create policy allowed_user_all on public.%I for all to authenticated using (public.is_allowed_user()) with check (public.is_allowed_user())',
      t
    );
  end loop;
end $$;
