-- Add demo/template columns to categories_subcategories
-- Safe-guard with IF NOT EXISTS where supported

-- Removed demo_enabled; enable/disable is controlled at the instance level

ALTER TABLE public.categories_subcategories
ADD COLUMN IF NOT EXISTS demo_template_config jsonb;

ALTER TABLE public.categories_subcategories
ADD COLUMN IF NOT EXISTS demo_branding jsonb;

-- Optional index to quickly find demo-ready subcategories by slug
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE schemaname = 'public' AND indexname = 'idx_categories_subcategories_slug'
  ) THEN
    CREATE INDEX idx_categories_subcategories_slug ON public.categories_subcategories (slug);
  END IF;
END $$;

