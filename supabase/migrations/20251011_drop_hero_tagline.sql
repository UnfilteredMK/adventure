BEGIN;

-- Remove hero_tagline; hero paragraph will use overview/seo_description instead
ALTER TABLE public.categories_subcategories
  DROP COLUMN IF EXISTS hero_tagline;

COMMIT;


