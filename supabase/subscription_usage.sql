-- Per-user question limits, plan status, and model token usage.
-- Run this once in Supabase Dashboard > SQL Editor.

create table if not exists public.account_usage (
    user_id uuid primary key references auth.users(id) on delete cascade,
    questions_used integer not null default 0 check (questions_used >= 0),
    input_tokens bigint not null default 0 check (input_tokens >= 0),
    output_tokens bigint not null default 0 check (output_tokens >= 0),
    subscription_status text not null default 'free'
        check (subscription_status in ('free', 'active', 'canceling', 'canceled', 'past_due')),
    subscription_ends_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.account_usage enable row level security;
drop policy if exists "Users can view their own usage" on public.account_usage;
create policy "Users can view their own usage"
    on public.account_usage for select to authenticated
    using ((select auth.uid()) = user_id);
revoke all on public.account_usage from anon, authenticated;
grant select on public.account_usage to authenticated;

create or replace function public.create_account_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.account_usage (user_id) values (new.id)
    on conflict (user_id) do nothing;
    return new;
end;
$$;

drop trigger if exists create_account_usage_after_signup on auth.users;
create trigger create_account_usage_after_signup
    after insert on auth.users
    for each row execute function public.create_account_usage();

insert into public.account_usage (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.consume_question(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_usage public.account_usage%rowtype;
    v_subscribed boolean;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'This operation is server-only.' using errcode = '42501';
    end if;

    insert into public.account_usage (user_id) values (p_user_id)
    on conflict (user_id) do nothing;

    select * into v_usage from public.account_usage where user_id = p_user_id for update;
    v_subscribed := v_usage.subscription_status in ('active', 'canceling')
        and (v_usage.subscription_ends_at is null or v_usage.subscription_ends_at > now());

    if not v_subscribed and v_usage.questions_used >= 2 then
        return jsonb_build_object(
            'allowed', false,
            'questions_used', v_usage.questions_used,
            'questions_remaining', 0,
            'subscription_status', v_usage.subscription_status
        );
    end if;

    update public.account_usage
       set questions_used = questions_used + 1, updated_at = now()
     where user_id = p_user_id
     returning * into v_usage;

    return jsonb_build_object(
        'allowed', true,
        'questions_used', v_usage.questions_used,
        'questions_remaining', case when v_subscribed then null else greatest(0, 2 - v_usage.questions_used) end,
        'subscription_status', v_usage.subscription_status
    );
end;
$$;

create or replace function public.refund_question(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'This operation is server-only.' using errcode = '42501';
    end if;
    update public.account_usage
       set questions_used = greatest(0, questions_used - 1), updated_at = now()
     where user_id = p_user_id;
end;
$$;

create or replace function public.record_token_usage(p_user_id uuid, p_input_tokens integer, p_output_tokens integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'This operation is server-only.' using errcode = '42501';
    end if;
    if p_input_tokens < 0 or p_output_tokens < 0 then
        raise exception 'Token counts cannot be negative.' using errcode = '22023';
    end if;
    update public.account_usage
       set input_tokens = input_tokens + p_input_tokens,
           output_tokens = output_tokens + p_output_tokens,
           updated_at = now()
     where user_id = p_user_id;
end;
$$;

revoke all on function public.consume_question(uuid) from public, anon, authenticated;
revoke all on function public.refund_question(uuid) from public, anon, authenticated;
revoke all on function public.record_token_usage(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_question(uuid) to service_role;
grant execute on function public.refund_question(uuid) to service_role;
grant execute on function public.record_token_usage(uuid, integer, integer) to service_role;
