-- 在一般 Postgres（例如 CI 的 postgres:17 容器）模擬 Supabase：
--  * anon / authenticated / service_role 三個角色（service_role 繞過 RLS）
--  * public schema 新物件預設 grant 給這三個角色（Supabase 的預設值；0001/0002 必須在這個前提下仍然安全）
-- 可重跑（角色已存在就略過）。
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
