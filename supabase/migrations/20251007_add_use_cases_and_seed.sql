BEGIN;

ALTER TABLE public.categories_subcategories
  ADD COLUMN IF NOT EXISTS use_cases jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS overview text;

-- Seed overview and 3-6 use cases where missing
UPDATE public.categories_subcategories AS cs
SET 
  overview = COALESCE(cs.overview, 'Adventure helps with ' || cs.subcategory || ' by letting customers preview results before committing.'),
  use_cases = COALESCE(cs.use_cases, (
    jsonb_build_array(
      jsonb_build_object('title', 'Try before you buy', 'desc', 'Customers preview outcomes to boost confidence and reduce returns.'),
      jsonb_build_object('title', 'Personalized previews', 'desc', 'Tailor results to customer inputs for higher engagement.'),
      jsonb_build_object('title', 'Before/After visuals', 'desc', 'Show compelling transformations that drive decisions.')
    )
  ))
WHERE cs.status = 'active';

COMMIT;

