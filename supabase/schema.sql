-- NectarSpend base schema (legacy database identifiers retained for compatibility). Run in the Supabase SQL editor as the project owner.
-- Transactional and rerunnable for this schema; does not delete existing rows.
begin;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text check (name is null or char_length(name) <= 40),
  currency text not null default 'NGN' check (currency in ('NGN','USD','GBP','EUR','GHS','KES')),
  starting_balance numeric(14,2) not null default 0 check (starting_balance between 0 and 999999999),
  monthly_spend_cap numeric(14,2) not null default 0 check (monthly_spend_cap between 0 and 999999999),
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  target numeric(14,2) not null check (target > 0 and target <= 999999999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id,id)
);
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  type text not null check (type in ('spent','saved')),
  amount numeric(14,2) not null check (amount > 0 and amount <= 999999999),
  category text not null,
  note text check (note is null or char_length(note) <= 120),
  date date not null check (date between date '0001-01-01' and date '9999-12-31'),
  goal_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((type='spent' and category in ('Food','Transport','School','Fun','Bills','Other')) or (type='saved' and category in ('Allowance','Work','Gift','Other'))),
  check (type='saved' or goal_id is null),
  -- Composite ownership prevents a user linking their save to another user's goal.
  -- PostgreSQL 15+: unset only goal_id, retaining the NOT NULL owner.
  foreign key (user_id,goal_id) references public.goals(user_id,id) on delete set null (goal_id)
);
create index if not exists fold_transactions_user_date on public.transactions(user_id,date desc,created_at desc);
create index if not exists fold_transactions_goal on public.transactions(user_id,goal_id) where goal_id is not null;
create index if not exists fold_goals_user_created on public.goals(user_id,created_at);

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at=now(); return new; end;
$$;
revoke all on function public.set_updated_at() from public;
drop trigger if exists fold_profile_updated on public.profiles;
create trigger fold_profile_updated before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists fold_goal_updated on public.goals;
create trigger fold_goal_updated before update on public.goals for each row execute function public.set_updated_at();
drop trigger if exists fold_transaction_updated on public.transactions;
create trigger fold_transaction_updated before update on public.transactions for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.goals enable row level security;
alter table public.transactions enable row level security;
alter table public.profiles force row level security;
alter table public.goals force row level security;
alter table public.transactions force row level security;
revoke all on public.profiles,public.goals,public.transactions from public,anon,authenticated;
grant select,insert,update,delete on public.profiles,public.goals,public.transactions to authenticated;

-- Permissive owner policy supplies all four operations; restrictive owner guard
-- prevents an additional permissive policy from accidentally widening ownership.
do $$
declare t text;
begin
  foreach t in array array['profiles','goals','transactions'] loop
    execute format('drop policy if exists fold_owner on public.%I',t);
    execute format('drop policy if exists fold_owner_guard on public.%I',t);
    execute format('create policy fold_owner on public.%I for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',t);
    execute format('create policy fold_owner_guard on public.%I as restrictive for all to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id)',t);
  end loop;
end $$;

commit;
