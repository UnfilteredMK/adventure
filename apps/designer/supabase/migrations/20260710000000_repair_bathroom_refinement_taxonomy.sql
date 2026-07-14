begin;

-- V1 pilot hard stop: the legacy Bathroom Remodeling taxonomy accidentally
-- inherited three exterior-hardscape components. Remove those components and
-- option records deterministically before the visual-pricing journey is enabled.
create temporary table bathroom_invalid_refinement_images on commit drop as
select
  image.id,
  image.prompt_id
from public.images as image
where image.subcategory_id = '258f4d7f-746f-416b-b617-e1cca25b748f'::uuid
  and image.metadata->>'generated_for' = 'refinement_option'
  and lower(coalesce(image.metadata->>'refinement_category_key', '')) in (
    'pavers',
    'outdoor_lighting',
    'walkway'
  );

delete from public.images as image
using bathroom_invalid_refinement_images as invalid
where image.id = invalid.id;

-- Refinement prompts are created solely for their generated option image. Do
-- not leave the rejected Bathroom prompts searchable after their images go.
delete from public.prompts as prompt
using bathroom_invalid_refinement_images as invalid
where prompt.id = invalid.prompt_id
  and not exists (
    select 1
    from public.images as remaining_image
    where remaining_image.prompt_id = prompt.id
  );

update public.categories_subcategories as subcategory
set
  subcategory_components = coalesce(
    (
      select jsonb_agg(component.value order by component.ordinality)
      from jsonb_array_elements(
        case
          when jsonb_typeof(subcategory.subcategory_components) = 'array'
            then subcategory.subcategory_components
          else '[]'::jsonb
        end
      ) with ordinality as component(value, ordinality)
      where lower(coalesce(component.value->>'key', '')) not in (
        'pavers',
        'outdoor_lighting',
        'walkway'
      )
    ),
    '[]'::jsonb
  ),
  updated_at = now()
where subcategory.id = '258f4d7f-746f-416b-b617-e1cca25b748f'::uuid;

-- Fail the migration if either the published taxonomy or its DB-backed option
-- catalog still exposes a rejected key.
do $$
begin
  if exists (
    select 1
    from public.categories_subcategories as subcategory
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(subcategory.subcategory_components) = 'array'
          then subcategory.subcategory_components
        else '[]'::jsonb
      end
    ) as component
    where subcategory.id = '258f4d7f-746f-416b-b617-e1cca25b748f'::uuid
      and lower(coalesce(component->>'key', '')) in (
        'pavers',
        'outdoor_lighting',
        'walkway'
      )
  ) then
    raise exception 'Bathroom Remodeling still contains rejected refinement components';
  end if;

  if exists (
    select 1
    from public.images as image
    where image.subcategory_id = '258f4d7f-746f-416b-b617-e1cca25b748f'::uuid
      and image.metadata->>'generated_for' = 'refinement_option'
      and lower(coalesce(image.metadata->>'refinement_category_key', '')) in (
        'pavers',
        'outdoor_lighting',
        'walkway'
      )
  ) then
    raise exception 'Bathroom Remodeling still contains rejected refinement option images';
  end if;
end;
$$;

commit;
