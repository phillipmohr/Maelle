-- IRDR-455: mailbox history import. Additive only (a seed row, a new column, two new tables).
-- The foundation migration is never edited.

-- ---------------------------------------------------------------- apps + settings: the one app row every ingest needs

-- A fresh project never ran `pnpm db:seed` (that script carries the design's sample tickets, which
-- production must not get), so the first real customer mail failed on the missing app row. The id is
-- the same deterministic uuid the seed uses (shared/seed/data.ts SEED_APP_ID), so seeding later
-- stays idempotent.
insert into public.apps (id, key, name, support_mailbox)
values ('a8ff4539-2ae2-8417-85d6-d0eaeabcf752', 'instaradar', 'InstaRadar', 'support@instaradar.app')
on conflict (key) do nothing;

insert into public.settings (app_id)
select id from public.apps where key = 'instaradar'
on conflict (app_id) do nothing;

-- ---------------------------------------------------------------- tickets: imported from the mailbox history

alter table public.tickets add column if not exists imported_at timestamptz;

comment on column public.tickets.imported_at is 'Set by the history import: the ticket was closed on arrival and never got an agent run; its case comes from the classify-only pass.';

create index if not exists tickets_imported_at_idx on public.tickets (imported_at) where imported_at is not null;

-- ---------------------------------------------------------------- mail_backfills: one cursor per folder

create table if not exists public.mail_backfills (
  mailbox text not null,
  folder text not null check (folder in ('inbox', 'sent')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  -- IMAP UIDVALIDITY of the folder; a change restarts the folder from the beginning
  uid_validity text,
  -- last UID handled (the cursor) and the highest UID when the import started (the denominator)
  last_uid bigint,
  max_uid bigint,
  listed integer not null default 0,
  imported integer not null default 0,
  skipped integer not null default 0,
  ignored integer not null default 0,
  failed integer not null default 0,
  tickets_created integer not null default 0,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (mailbox, folder)
);

drop trigger if exists mail_backfills_set_updated_at on public.mail_backfills;
create trigger mail_backfills_set_updated_at before update on public.mail_backfills
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- ticket_classifications: the classify-only pass

create table if not exists public.ticket_classifications (
  ticket_id uuid primary key references public.tickets(id) on delete cascade,
  attempts integer not null default 0,
  model text,
  case_type text,
  confidence real,
  rationale text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists ticket_classifications_set_updated_at on public.ticket_classifications;
create trigger ticket_classifications_set_updated_at before update on public.ticket_classifications
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- RLS: only the allowed user (service role bypasses)

do $$
declare
  t text;
begin
  foreach t in array array['mail_backfills', 'ticket_classifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists allowed_user_all on public.%I', t);
    execute format(
      'create policy allowed_user_all on public.%I for all to authenticated using (public.is_allowed_user()) with check (public.is_allowed_user())',
      t
    );
  end loop;
end $$;
