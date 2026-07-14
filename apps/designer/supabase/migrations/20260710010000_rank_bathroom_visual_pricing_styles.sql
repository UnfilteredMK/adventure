-- Visual Pricing Journey V1 pilot: surface six deterministic Bathroom Remodeling styles first.
with bathroom_styles as (
  select
    i.id,
    row_number() over (order by i.created_at asc nulls last, i.id asc) as featured_rank
  from public.images i
  join public.categories_subcategories cs on cs.id = i.subcategory_id
  where lower(btrim(cs.subcategory)) = 'bathroom remodeling'
    and i.status = 'completed'
    and i.account_id is null
    and coalesce(i.metadata->>'generated_for', '') in ('style_seed', 'subcategory_catalog')
    and nullif(btrim(coalesce(i.metadata->>'option_label', '')), '') is not null
  order by i.created_at asc nulls last, i.id asc
  limit 6
)
update public.images i
set metadata = jsonb_set(
  case when jsonb_typeof(i.metadata) = 'object' then i.metadata else '{}'::jsonb end,
  '{featured_rank}',
  to_jsonb(bathroom_styles.featured_rank),
  true
)
from bathroom_styles
where i.id = bathroom_styles.id;

