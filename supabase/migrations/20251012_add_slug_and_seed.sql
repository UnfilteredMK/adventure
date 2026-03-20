BEGIN;

-- 1) Add slug column for stable routing
ALTER TABLE public.categories_subcategories
  ADD COLUMN IF NOT EXISTS slug text;

-- 2) Seed slug from subcategory (simple slugification: lowercase, spaces/delims -> hyphen)
UPDATE public.categories_subcategories
SET slug = regexp_replace(lower(subcategory), '[^a-z0-9]+', '-', 'g')
WHERE (slug IS NULL OR length(trim(slug)) = 0);

-- 3) Optional: make it unique and indexed for fast lookup (ignore if conflicts in existing data)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_categories_subcategories_slug'
  ) THEN
    CREATE UNIQUE INDEX idx_categories_subcategories_slug ON public.categories_subcategories(slug);
  END IF;
EXCEPTION WHEN others THEN
  -- Fallback to non-unique index if duplicates exist
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_categories_subcategories_slug_nonuniq'
    ) THEN
      CREATE INDEX idx_categories_subcategories_slug_nonuniq ON public.categories_subcategories(slug);
    END IF;
  END;
END $$;

COMMIT;


