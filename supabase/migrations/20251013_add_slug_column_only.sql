BEGIN;

ALTER TABLE public.categories_subcategories
  ADD COLUMN IF NOT EXISTS slug text;

UPDATE public.categories_subcategories
SET slug = regexp_replace(lower(subcategory), '[^a-z0-9]+', '-', 'g')
WHERE (slug IS NULL OR length(trim(slug)) = 0);

CREATE INDEX IF NOT EXISTS idx_categories_subcategories_slug_nonuniq
  ON public.categories_subcategories(slug);

COMMIT;


