-- If 023 previously created subcategory_scope as enum[], convert to text[] (idempotent).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE n.nspname = 'public'
      AND c.relname = 'categories_subcategories'
      AND a.attname = 'subcategory_scope'
      AND NOT a.attisdropped
      AND a.attnum > 0
      AND t.typname = '_subcategory_scope_option'
  ) THEN
    ALTER TABLE public.categories_subcategories
      DROP CONSTRAINT IF EXISTS categories_subcategories_subcategory_scope_nonempty;

    ALTER TABLE public.categories_subcategories
      ALTER COLUMN subcategory_scope DROP DEFAULT;

    ALTER TABLE public.categories_subcategories
      ALTER COLUMN subcategory_scope TYPE text[]
      USING ARRAY(SELECT unnest(subcategory_scope)::text);

    ALTER TABLE public.categories_subcategories
      ALTER COLUMN subcategory_scope SET DEFAULT '{}'::text[];

    ALTER TABLE public.categories_subcategories
      ALTER COLUMN subcategory_scope SET NOT NULL;

    COMMENT ON COLUMN public.categories_subcategories.subcategory_scope IS
      'Preset scope answer options for the first step (or early scope questions), e.g. typical project sizes or areas for this industry.';

    DROP TYPE IF EXISTS public.subcategory_scope_option;
  END IF;
END $$;
