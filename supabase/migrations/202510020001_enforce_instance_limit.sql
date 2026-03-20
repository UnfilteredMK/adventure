-- Enforce per-plan instance limits at the database level
-- Blocks inserts into public.instances when an account has reached its plan limit

create or replace function public.can_create_instance(p_account_id uuid)
returns boolean
language plpgsql
stable
as $$
declare
  v_plan_id text;
  v_max_widgets integer;
  v_current_count integer;
begin
  -- Get most recent subscription for the account
  select us.plan_id
  into v_plan_id
  from public.user_subscriptions us
  where us.account_id = p_account_id
  order by us.created_at desc
  limit 1;

  -- If no plan found, treat as no limit (or set to 0 to block)
  if v_plan_id is null then
    return true;
  end if;

  -- Look up plan's max_widgets
  select p.max_widgets
  into v_max_widgets
  from public.plans p
  where p.plan_id = v_plan_id
  limit 1;

  -- If plan has no max (NULL), allow unlimited
  if v_max_widgets is null then
    return true;
  end if;

  -- Count current instances for the account
  select count(*)
  into v_current_count
  from public.instances i
  where i.account_id = p_account_id;

  return v_current_count < v_max_widgets;
end;
$$;

-- Trigger to enforce on all inserts
create or replace function public.enforce_instance_limit()
returns trigger
language plpgsql
as $$
begin
  if not public.can_create_instance(new.account_id) then
    raise exception 'Plan instance limit reached for this account'
      using errcode = '23514'; -- check_violation
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_instance_limit on public.instances;
create trigger trg_enforce_instance_limit
before insert on public.instances
for each row execute function public.enforce_instance_limit();


