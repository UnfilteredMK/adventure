BEGIN;

-- Drop redundant denormalized column; rely on join to categories via category_id
ALTER TABLE public.categories_subcategories
  DROP COLUMN IF EXISTS category_name;

COMMIT;


