-- Add demo-related fields to prospects to enable local theme-based demos

begin;

alter table if exists public.prospects
  add column if not exists demo_theme_key text,
  add column if not exists demo_template_config jsonb,
  add column if not exists demo_branding jsonb;

-- Helpful index for theme lookup/filtering
do $$
begin
  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_prospects_demo_theme_key'
  ) then
    create index idx_prospects_demo_theme_key on public.prospects (demo_theme_key);
  end if;
end $$;

commit;


