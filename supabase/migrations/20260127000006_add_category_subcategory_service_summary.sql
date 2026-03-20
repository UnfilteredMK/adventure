BEGIN;

-- Adds a richer, human-readable explanation of the "service" represented by a subcategory.
ALTER TABLE public.categories_subcategories
  ADD COLUMN IF NOT EXISTS service_summary text NULL;

COMMENT ON COLUMN public.categories_subcategories.service_summary IS
  'Short paragraph describing what the service is, typical providers, and how it works.';

COMMIT;

