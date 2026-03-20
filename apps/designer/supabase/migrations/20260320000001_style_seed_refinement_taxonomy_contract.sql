begin;

update public.images
set
  metadata = jsonb_set(
    case
      when jsonb_typeof(metadata) = 'object' then metadata
      else '{}'::jsonb
    end,
    '{generated_for}',
    to_jsonb('style_seed'::text),
    true
  ),
  updated_at = now()
where metadata->>'generated_for' = 'subcategory_catalog';

create or replace function public.is_valid_subcategory_components(components jsonb)
returns boolean
language sql
immutable
as $$
  select
    components is null
    or (
      jsonb_typeof(components) = 'array'
      and not exists (
        select 1
        from jsonb_array_elements(components) as elem
        where jsonb_typeof(elem) <> 'object'
          or coalesce(nullif(btrim(elem->>'key'), ''), '') = ''
          or coalesce(nullif(btrim(elem->>'label'), ''), '') = ''
          or not (elem ? 'priority')
          or jsonb_typeof(elem->'priority') <> 'number'
      )
    );
$$;

alter table public.categories_subcategories
  drop constraint if exists categories_subcategories_components_schema_check;

alter table public.categories_subcategories
  add constraint categories_subcategories_components_schema_check
  check (public.is_valid_subcategory_components(subcategory_components));

create or replace function public.is_valid_image_metadata(meta jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  role text := nullif(btrim(coalesce(meta->>'generated_for', '')), '');
begin
  if meta is null then
    return true;
  end if;

  if jsonb_typeof(meta) <> 'object' then
    return false;
  end if;

  if role is null then
    return true;
  end if;

  if role = 'style_seed' then
    return coalesce(meta->>'catalog_key', '') <> ''
       and coalesce(meta->>'catalog_scope', '') <> ''
       and coalesce(meta->>'option_label', '') <> ''
       and coalesce(meta->>'option_value', '') <> '';

  elsif role = 'refinement_option' then
    return coalesce(meta->>'refinement_category_key', '') <> ''
       and coalesce(meta->>'refinement_category_label', '') <> ''
       and coalesce(meta->>'refinement_variation_key', '') <> ''
       and coalesce(meta->>'refinement_variation_label', '') <> '';

  elsif role = 'sample_gallery' then
    return true;

  else
    return true;
  end if;
end;
$$;

alter table public.images
  drop constraint if exists images_metadata_role_schema_check;

alter table public.images
  add constraint images_metadata_role_schema_check
  check (public.is_valid_image_metadata(metadata));

alter table public.images
  drop constraint if exists images_refinement_option_requires_subcategory_check;

alter table public.images
  add constraint images_refinement_option_requires_subcategory_check
  check (
    coalesce(metadata->>'generated_for', '') <> 'refinement_option'
    or subcategory_id is not null
  );

create or replace function public.validate_refinement_option_component_match()
returns trigger
language plpgsql
as $$
declare
  role text := nullif(btrim(coalesce(new.metadata->>'generated_for', '')), '');
  category_key text := nullif(btrim(coalesce(new.metadata->>'refinement_category_key', '')), '');
  matched boolean;
begin
  if role <> 'refinement_option' then
    return new;
  end if;

  if new.subcategory_id is null then
    raise exception 'refinement_option images require subcategory_id';
  end if;

  if category_key is null then
    raise exception 'refinement_option images require metadata.refinement_category_key';
  end if;

  select exists (
    select 1
    from public.categories_subcategories cs
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(cs.subcategory_components) = 'array' then cs.subcategory_components
        else '[]'::jsonb
      end
    ) as comp
    where cs.id = new.subcategory_id
      and comp->>'key' = category_key
  )
  into matched;

  if not matched then
    raise exception
      'refinement_category_key % is not defined in subcategory_components for subcategory %',
      category_key,
      new.subcategory_id;
  end if;

  return new;
end;
$$;

drop trigger if exists validate_refinement_option_component_match on public.images;

create trigger validate_refinement_option_component_match
before insert or update of metadata, subcategory_id
on public.images
for each row
execute function public.validate_refinement_option_component_match();

create index if not exists idx_images_generated_for
  on public.images ((metadata->>'generated_for'));

create index if not exists idx_images_style_seed_lookup
  on public.images (subcategory_id, created_at desc)
  where metadata->>'generated_for' = 'style_seed';

create index if not exists idx_images_refinement_option_lookup
  on public.images (subcategory_id, ((metadata->>'refinement_category_key')), created_at desc)
  where metadata->>'generated_for' = 'refinement_option';

commit;
