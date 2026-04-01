-- Typical scope answer strings for early / first-step questions (industry-specific options).
ALTER TABLE public.categories_subcategories
  ADD COLUMN IF NOT EXISTS subcategory_scope text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.categories_subcategories.subcategory_scope IS
  'Preset scope answer options for the first step (or early scope questions), e.g. typical project sizes or areas for this industry.';
