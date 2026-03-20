-- Add partner_approval enum and column to user_subscriptions
-- Safe to run multiple times: create type if not exists, add column if not exists

do $$ begin
  create type partner_approval_status as enum ('pending', 'approved');
exception when duplicate_object then null; end $$;

alter table if exists user_subscriptions
  add column if not exists partner_approval partner_approval_status;

-- Backfill: default approved for existing non-partner subs, pending for partner
-- We infer partner by joining to plans table where onboarding_type = 'partner'
update user_subscriptions us
set partner_approval = case when p.onboarding_type = 'partner' then 'pending'::partner_approval_status else 'approved'::partner_approval_status end
from plans p
where us.plan_id = p.plan_id and us.partner_approval is null;

-- Optional: set a default for new rows (approved by default)
alter table if exists user_subscriptions
  alter column partner_approval set default 'approved';

-- Not null once backfilled
update user_subscriptions set partner_approval = 'approved' where partner_approval is null;
alter table if exists user_subscriptions
  alter column partner_approval set not null;


