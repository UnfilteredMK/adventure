create table if not exists public.instance_config_versions (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.instances (id) on delete cascade,
  created_at timestamptz not null default now(),
  user_id uuid null references auth.users (id),
  previous_config jsonb not null,
  next_config jsonb not null
);

create index if not exists instance_config_versions_instance_id_created_at_idx
  on public.instance_config_versions (instance_id, created_at desc);

alter table public.instance_config_versions enable row level security;

