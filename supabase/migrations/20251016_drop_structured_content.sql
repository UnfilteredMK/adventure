BEGIN;

ALTER TABLE public.categories_subcategories
  DROP COLUMN IF EXISTS who_benefits,
  DROP COLUMN IF EXISTS why_it_ranks,
  DROP COLUMN IF EXISTS why_with_ai,
  DROP COLUMN IF EXISTS built_for,
  DROP COLUMN IF EXISTS content_md;

COMMIT;


