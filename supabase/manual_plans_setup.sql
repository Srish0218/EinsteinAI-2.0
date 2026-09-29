-- Manual plan assignment and question credits for EinsteinAI.
-- Run this once in Supabase Dashboard > SQL Editor after subscription_usage.sql.

alter table public.account_usage
    add column if not exists question_credits integer not null default 0 check (question_credits >= 0),
    add column if not exists question_credits_expires_at timestamptz,
    add column if not exists plan_type text not null default 'free';

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'account_usage_plan_type_check'
          and conrelid = 'public.account_usage'::regclass
    ) then
        alter table public.account_usage
            add constraint account_usage_plan_type_check
            check (plan_type in ('free', 'questions_10', 'monthly', 'yearly'));
    end if;
end;
$$;

-- Set plan status and expiry automatically whenever an administrator assigns a plan.
-- Monthly/yearly plans expire one month/year from assignment. A 10-question pack
-- expires at the next midnight in India Standard Time.
create or replace function public.apply_manual_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.plan_type = 'monthly' then
        new.subscription_status := 'active';
        new.subscription_ends_at := now() + interval '1 month';
        new.question_credits := 0;
        new.question_credits_expires_at := null;
    elsif new.plan_type = 'yearly' then
        new.subscription_status := 'active';
        new.subscription_ends_at := now() + interval '1 year';
        new.question_credits := 0;
        new.question_credits_expires_at := null;
    elsif new.plan_type = 'questions_10' then
        new.subscription_status := 'free';
        new.subscription_ends_at := null;
        if tg_op = 'UPDATE' and old.question_credits_expires_at > now() then
            new.question_credits := old.question_credits + 10;
        else
            new.question_credits := 10;
        end if;
        new.question_credits_expires_at := ((now() at time zone 'Asia/Kolkata')::date + 1)::timestamp at time zone 'Asia/Kolkata';
    else
        new.subscription_status := 'free';
        new.subscription_ends_at := null;
        new.question_credits := 0;
        new.question_credits_expires_at := null;
    end if;
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists apply_manual_plan_before_change on public.account_usage;
create trigger apply_manual_plan_before_change
    before insert or update of plan_type on public.account_usage
    for each row execute function public.apply_manual_plan();

-- Give any pre-existing unexpired credits an end-of-day expiry once.
update public.account_usage
   set question_credits_expires_at = ((now() at time zone 'Asia/Kolkata')::date + 1)::timestamp at time zone 'Asia/Kolkata'
 where question_credits > 0 and question_credits_expires_at is null;

create or replace function public.consume_question(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_usage public.account_usage%rowtype;
    v_subscribed boolean;
    v_used_credit boolean := false;
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'This operation is server-only.' using errcode = '42501';
    end if;
    insert into public.account_usage (user_id) values (p_user_id)
    on conflict (user_id) do nothing;
    select * into v_usage from public.account_usage where user_id = p_user_id for update;
    v_subscribed := v_usage.subscription_status in ('active', 'canceling')
        and (v_usage.subscription_ends_at is null or v_usage.subscription_ends_at > now());

    if not v_subscribed and v_usage.question_credits > 0
       and v_usage.question_credits_expires_at is not null
       and v_usage.question_credits_expires_at <= now() then
        update public.account_usage set question_credits = 0, updated_at = now()
         where user_id = p_user_id returning * into v_usage;
    end if;

    if not v_subscribed and v_usage.questions_used >= 2 then
        if v_usage.question_credits <= 0 then
            return jsonb_build_object('allowed', false, 'questions_used', v_usage.questions_used,
                'questions_remaining', 0, 'question_credits', 0, 'subscription_status', v_usage.subscription_status);
        end if;
        update public.account_usage set question_credits = question_credits - 1, updated_at = now()
         where user_id = p_user_id returning * into v_usage;
        v_used_credit := true;
    else
        update public.account_usage set questions_used = questions_used + 1, updated_at = now()
         where user_id = p_user_id returning * into v_usage;
    end if;

    return jsonb_build_object('allowed', true, 'questions_used', v_usage.questions_used,
        'questions_remaining', case when v_subscribed then null else greatest(0, 2 - v_usage.questions_used) + v_usage.question_credits end,
        'question_credits', v_usage.question_credits, 'used_credit', v_used_credit,
        'subscription_status', v_usage.subscription_status);
end;
$$;

create or replace function public.refund_question(p_user_id uuid, p_used_credit boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if coalesce(auth.role(), '') <> 'service_role' then
        raise exception 'This operation is server-only.' using errcode = '42501';
    end if;
    if p_used_credit then
        update public.account_usage set question_credits = question_credits + 1, updated_at = now() where user_id = p_user_id;
    else
        update public.account_usage set questions_used = greatest(0, questions_used - 1), updated_at = now() where user_id = p_user_id;
    end if;
end;
$$;

revoke all on function public.consume_question(uuid) from public, anon, authenticated;
revoke all on function public.refund_question(uuid) from public, anon, authenticated;
revoke all on function public.refund_question(uuid, boolean) from public, anon, authenticated;
grant execute on function public.consume_question(uuid) to service_role;
grant execute on function public.refund_question(uuid, boolean) to service_role;
