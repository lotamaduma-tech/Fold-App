-- NectarSpend: additive upgrade from the existing three-table schema.
-- Apply AFTER schema.sql on a new project; apply ONLY this file on an existing project.
begin;

create table if not exists public.workspaces (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(user_id) on delete cascade,
    name text not null check (char_length(btrim(name)) between 1 and 60),
    kind text not null check (kind in ('personal', 'business')),
    currency text not null default 'NGN'
        check (currency in ('NGN', 'USD', 'GBP', 'EUR', 'GHS', 'KES')),
    starting_balance numeric(14,2) not null default 0
        check (starting_balance between 0 and 999999999),
    monthly_spend_cap numeric(14,2) not null default 0
        check (monthly_spend_cap between 0 and 999999999),
    setup_completed boolean not null default false,
    is_legacy_default boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, id)
);

create unique index if not exists nectar_legacy_workspace
on public.workspaces(user_id)
where is_legacy_default;

alter table public.profiles
add column if not exists usage_mode text
check (usage_mode in ('personal', 'business', 'both'));

alter table public.goals
add column if not exists workspace_id uuid;

alter table public.transactions
add column if not exists workspace_id uuid;

alter table public.transactions
add column if not exists record_kind text;

alter table public.transactions
add column if not exists is_savings boolean;

insert into public.workspaces (
    user_id,
    name,
    kind,
    currency,
    starting_balance,
    monthly_spend_cap,
    setup_completed,
    is_legacy_default
)
select
    p.user_id,
    'Personal',
    'personal',
    p.currency,
    p.starting_balance,
    p.monthly_spend_cap,
    p.onboarding_completed,
    true
from public.profiles p
where p.usage_mode is null
and not exists (
    select 1
    from public.workspaces w
    where w.user_id = p.user_id
)
on conflict do nothing;

update public.profiles p
set usage_mode = 'personal'
where usage_mode is null
and exists (
    select 1
    from public.workspaces w
    where w.user_id = p.user_id
    and w.is_legacy_default
);

update public.goals g
set workspace_id = w.id
from public.workspaces w
where g.user_id = w.user_id
and w.is_legacy_default
and g.workspace_id is null;

update public.transactions t
set workspace_id = w.id
from public.workspaces w
where t.user_id = w.user_id
and w.is_legacy_default
and t.workspace_id is null;

update public.transactions
set
    record_kind = case
        when type = 'spent' then 'expense'
        else 'income'
    end,
    is_savings = (type = 'saved')
where record_kind is null;

alter table public.goals
alter column workspace_id set not null;

alter table public.transactions
alter column workspace_id set not null;

alter table public.transactions
alter column record_kind set not null;

alter table public.transactions
alter column is_savings set not null;

alter table public.transactions
alter column type set default 'saved';

alter table public.transactions
drop constraint if exists transactions_check;

alter table public.transactions
drop constraint if exists transactions_check1;

alter table public.transactions
drop constraint if exists transactions_user_id_goal_id_fkey;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'nectar_goals_workspace_unique'
    ) then
        alter table public.goals
        add constraint nectar_goals_workspace_unique
        unique (user_id, workspace_id, id);

        alter table public.goals
        add constraint nectar_goals_workspace_fk
        foreign key (user_id, workspace_id)
        references public.workspaces(user_id, id)
        on delete cascade;

        alter table public.transactions
        add constraint nectar_records_workspace_fk
        foreign key (user_id, workspace_id)
        references public.workspaces(user_id, id)
        on delete cascade;

        alter table public.transactions
        add constraint nectar_records_goal_fk
        foreign key (user_id, workspace_id, goal_id)
        references public.goals(user_id, workspace_id, id)
        on delete set null (goal_id);

        alter table public.transactions
        add constraint nectar_record_kind
        check (record_kind in ('income', 'expense', 'saving'));

        alter table public.transactions
        add constraint nectar_savings_consistency
        check (
            (record_kind = 'saving' and is_savings)
            or record_kind = 'income'
            or (record_kind = 'expense' and not is_savings)
        );

        alter table public.transactions
        add constraint nectar_goal_allocation
        check (goal_id is null or is_savings);
    end if;
end
$$;

create index if not exists nectar_records_workspace_date
on public.transactions (
    user_id,
    workspace_id,
    date desc,
    created_at desc
);

create index if not exists nectar_goals_workspace
on public.goals(user_id, workspace_id);

alter table public.workspaces enable row level security;

alter table public.workspaces force row level security;

revoke all on public.workspaces
from public, anon, authenticated;

grant select, insert, update, delete
on public.workspaces
to authenticated;

drop policy if exists nectar_owner
on public.workspaces;

drop policy if exists nectar_owner_guard
on public.workspaces;

create policy nectar_owner
on public.workspaces
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy nectar_owner_guard
on public.workspaces
as restrictive
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function public.nectar_record_rules()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
    workspace_kind text;
begin
    if new.workspace_id is null then
        select id
        into new.workspace_id
        from public.workspaces
        where user_id = new.user_id
        and is_legacy_default;
    end if;

    select kind
    into workspace_kind
    from public.workspaces
    where id = new.workspace_id
    and user_id = new.user_id;

    if workspace_kind is null then
        raise exception 'Workspace is not available.'
        using errcode = '42501';
    end if;

    if new.record_kind is null then
        new.record_kind = case
            when new.type = 'spent' then 'expense'
            else 'income'
        end;

        new.is_savings = (new.type = 'saved');
    end if;

    new.is_savings =
        coalesce(new.is_savings, false)
        or new.record_kind = 'saving';

    new.type = case
        when new.record_kind = 'expense' then 'spent'
        else 'saved'
    end;

    if workspace_kind = 'business' then
        if new.is_savings
            or new.goal_id is not null
            or new.record_kind = 'saving'
        then
            raise exception
                'Business records cannot allocate personal savings.'
            using errcode = '23514';
        end if;

        if not (
            (
                new.record_kind = 'income'
                and new.category in (
                    'Sales',
                    'Owner funding',
                    'Loan',
                    'Other'
                )
            )
            or
            (
                new.record_kind = 'expense'
                and new.category in (
                    'Stock',
                    'Delivery',
                    'Rent',
                    'Utilities',
                    'Wages',
                    'Owner draw',
                    'Loan repayment',
                    'Other'
                )
            )
        ) then
            raise exception 'Invalid business category.'
            using errcode = '23514';
        end if;
    else
        if not (
            (
                new.record_kind = 'income'
                and new.category in (
                    'Salary',
                    'Allowance',
                    'Gift',
                    'Work',
                    'Other'
                )
            )
            or
            (
                new.record_kind = 'expense'
                and new.category in (
                    'Food',
                    'Transport',
                    'Bills',
                    'Shopping',
                    'Entertainment',
                    'School',
                    'Fun',
                    'Other'
                )
            )
            or
            (
                new.record_kind = 'saving'
                and new.category = 'Savings'
            )
        ) then
            raise exception 'Invalid personal category.'
            using errcode = '23514';
        end if;
    end if;

    return new;
end
$$;

create or replace function public.nectar_goal_rules()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if new.workspace_id is null then
        select id
        into new.workspace_id
        from public.workspaces
        where user_id = new.user_id
        and is_legacy_default;
    end if;

    if not exists (
        select 1
        from public.workspaces
        where id = new.workspace_id
        and user_id = new.user_id
        and kind = 'personal'
    ) then
        raise exception 'Choose a personal workspace for goals.'
        using errcode = '42501';
    end if;

    return new;
end
$$;

drop trigger if exists nectar_record_rules
on public.transactions;

create trigger nectar_record_rules
before insert or update
on public.transactions
for each row
execute function public.nectar_record_rules();

drop trigger if exists nectar_goal_rules
on public.goals;

create trigger nectar_goal_rules
before insert or update
on public.goals
for each row
execute function public.nectar_goal_rules();

drop trigger if exists nectar_workspace_updated
on public.workspaces;

create trigger nectar_workspace_updated
before update
on public.workspaces
for each row
execute function public.set_updated_at();

create or replace function public.nectar_workspace_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.kind <> old.kind then
        raise exception 'Workspace type cannot be changed.'
        using errcode = '23514';
    end if;

    return new;
end
$$;

drop trigger if exists nectar_workspace_kind
on public.workspaces;

create trigger nectar_workspace_kind
before update
on public.workspaces
for each row
execute function public.nectar_workspace_kind();

create or replace function public.nectar_initialize_workspaces(
    p_expected_user_id uuid,
    p_mode text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    uid uuid := auth.uid();
begin
    if uid is null
        or uid is distinct from p_expected_user_id
    then
        raise exception 'Authentication required.'
        using errcode = '42501';
    end if;

    if p_mode not in ('personal', 'business', 'both')
        or p_mode is null
    then
        raise exception 'Invalid workspace choice.'
        using errcode = '23514';
    end if;

    perform 1
    from public.profiles
    where user_id = uid
    for update;

    if not found then
        raise exception 'Profile is missing.';
    end if;

    if exists (
        select 1
        from public.workspaces
        where user_id = uid
    ) then
        return;
    end if;

    if p_mode in ('personal', 'both') then
        insert into public.workspaces (
            user_id,
            name,
            kind,
            is_legacy_default
        )
        values (
            uid,
            'Personal',
            'personal',
            true
        );
    end if;

    if p_mode in ('business', 'both') then
        insert into public.workspaces (
            user_id,
            name,
            kind,
            created_at
        )
        values (
            uid,
            'My Business',
            'business',
            now() + interval '1 millisecond'
        );
    end if;

    update public.profiles
    set usage_mode = p_mode
    where user_id = uid;
end
$$;

create or replace function public.nectar_complete_workspace(
    p_expected_user_id uuid,
    p_workspace_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    uid uuid := auth.uid();
begin
    if uid is null
        or uid is distinct from p_expected_user_id
    then
        raise exception 'Authentication required.'
        using errcode = '42501';
    end if;

    update public.workspaces
    set setup_completed = true
    where id = p_workspace_id
    and user_id = uid;

    if not found then
        raise exception 'Workspace is not available.'
        using errcode = '42501';
    end if;

    update public.profiles
    set onboarding_completed = not exists (
        select 1
        from public.workspaces
        where user_id = uid
        and not setup_completed
    )
    where user_id = uid;
end
$$;

revoke all
on function public.nectar_initialize_workspaces(uuid, text),
            public.nectar_complete_workspace(uuid, uuid)
from public, anon;

grant execute
on function public.nectar_initialize_workspaces(uuid, text),
            public.nectar_complete_workspace(uuid, uuid)
to authenticated;

revoke all
on function public.nectar_record_rules(),
            public.nectar_goal_rules(),
            public.nectar_workspace_kind()
from public;

drop function if exists public.fold_replace_notebook(
    uuid,
    boolean,
    date
);

commit;