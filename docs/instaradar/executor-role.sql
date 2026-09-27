-- InstaRadar: the Postgres role behind Maelle's INSTARADAR_DB_WRITE_URL.
-- Exactly the grants the two executor actions need, nothing else. Run as the database owner.
-- Replace the password before running; the resulting URL is
--   postgresql://maelle_executor:<password>@<host>:5432/postgres?sslmode=require

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'maelle_executor') then
    create role maelle_executor login password 'replace-me' noinherit;
  end if;
end $$;

alter role maelle_executor set statement_timeout = '20s';
alter role maelle_executor set idle_in_transaction_session_timeout = '30s';

grant usage on schema public to maelle_executor;

-- Remove from tracking & viewing
grant select, insert on public.blocked_profiles to maelle_executor;
grant select, delete on public.tracked_profiles to maelle_executor;

-- Delete account: every table listed in INSTARADAR_USER_TABLES (default: tracked_profiles:user_id, profiles:id)
grant select, delete on public.profiles to maelle_executor;
-- grant select, delete on public.<other user table> to maelle_executor;

-- Optional (section 5 of README.md): delete the auth user inside the same transaction instead of
-- through the Auth admin API.
-- grant usage on schema auth to maelle_executor;
-- grant select, delete on auth.users to maelle_executor;

-- The role bypasses nothing: RLS applies unless the table has no policies for it, so either add
-- policies for maelle_executor or (simpler, since it is a trusted server role) let it bypass RLS:
alter role maelle_executor bypassrls;

-- The agent's read role must not become able to write.
-- revoke all on public.blocked_profiles from maelle_reader;
