-- InstaRadar: blocklist for the Maelle executor's "Remove from tracking & viewing" action.
-- Apply in the InstaRadar Supabase project (supabase/migrations/<timestamp>_blocked_profiles.sql).
-- Column names below are the InstaRadar database's: tracked_profiles.instagram_username.

create table if not exists public.blocked_profiles (
  username text primary key check (username = lower(username) and username not like '@%'),
  reason text not null,
  -- "Maelle ticket #4831": where the request came from, for the audit trail
  source text not null,
  blocked_at timestamptz not null default now()
);

comment on table public.blocked_profiles is
  'Instagram profiles that can neither be tracked nor viewed on InstaRadar (safety / removal requests). Written by the Maelle executor.';

-- Nobody but the service role and the executor role reads or writes this table.
alter table public.blocked_profiles enable row level security;
drop policy if exists blocked_profiles_no_access on public.blocked_profiles;
create policy blocked_profiles_no_access on public.blocked_profiles for all to authenticated using (false) with check (false);

-- Read path helper: everything the app shows goes through this view (or an equivalent join).
create or replace view public.visible_tracked_profiles
with (security_invoker = true) as
  select t.*
  from public.tracked_profiles t
  where not exists (select 1 from public.blocked_profiles b where b.username = lower(t.instagram_username));

-- Belt and braces: a blocked username can never be inserted into tracked_profiles again.
create or replace function public.refuse_blocked_profile()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.blocked_profiles b where b.username = lower(new.instagram_username)) then
    raise exception 'This profile is not available on InstaRadar' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists refuse_blocked_profile on public.tracked_profiles;
create trigger refuse_blocked_profile
  before insert or update of instagram_username on public.tracked_profiles
  for each row execute function public.refuse_blocked_profile();
