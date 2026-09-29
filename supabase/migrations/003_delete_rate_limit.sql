-- Security-only rate limit. No changes to financial tables or owner policies.
begin;
create schema if not exists nectar_private;
revoke all on schema nectar_private from public, anon, authenticated;
create table if not exists nectar_private.account_delete_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  attempts integer not null check (attempts between 1 and 4),
  expires_at timestamptz not null
);
create index if not exists nectar_delete_limits_expiry on nectar_private.account_delete_limits(expires_at);
alter table nectar_private.account_delete_limits enable row level security;
alter table nectar_private.account_delete_limits force row level security;
revoke all on nectar_private.account_delete_limits from public, anon, authenticated;
grant usage on schema nectar_private to service_role;
grant select, insert, update, delete on nectar_private.account_delete_limits to service_role;
create or replace function public.nectar_consume_delete_attempt(p_user_id uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare used integer;
begin
  -- Expired entries hold only a user ID/count, never tokens or financial data.
  delete from nectar_private.account_delete_limits where expires_at <= now();
  insert into nectar_private.account_delete_limits(user_id, attempts, expires_at)
  values(p_user_id, 1, now() + interval '15 minutes')
  on conflict (user_id) do update set attempts = least(nectar_private.account_delete_limits.attempts + 1, 4)
  returning attempts into used;
  return used <= 3;
end;
$$;
revoke all on function public.nectar_consume_delete_attempt(uuid) from public, anon, authenticated;
grant execute on function public.nectar_consume_delete_attempt(uuid) to service_role;
commit;
