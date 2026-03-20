-- Remove question_templates from categories_subcategories.
-- We are not storing flow questions in the DB at the subcategory level.

BEGIN;

ALTER TABLE public.categories_subcategories
DROP COLUMN IF EXISTS question_templates;

COMMIT;

