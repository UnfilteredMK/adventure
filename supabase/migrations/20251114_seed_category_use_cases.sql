-- Seed default use cases per category so the Primary Use Case step has data
-- Rules:
-- - Categories with instance_type in ('ecomm','both') get 'tryon'
-- - Categories with instance_type in ('service','both') get 'scene'
-- - Use ON CONFLICT to avoid duplicates for categories already configured

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'use_case_type') THEN
    CREATE TYPE use_case_type AS ENUM ('tryon', 'scene');
  END IF;
END
$$;

-- Try‑ons for ecomm/both
INSERT INTO public.category_use_cases (category_id, use_case, ai_model_profile, metadata)
SELECT c.id, 'tryon'::use_case_type, NULL, '{}'::jsonb
FROM public.categories c
WHERE c.status = 'active'
  AND (c.instance_type IN ('ecomm', 'both'))
ON CONFLICT (category_id, use_case) DO NOTHING;

-- Scene for service/both
INSERT INTO public.category_use_cases (category_id, use_case, ai_model_profile, metadata)
SELECT c.id, 'scene'::use_case_type, NULL, '{}'::jsonb
FROM public.categories c
WHERE c.status = 'active'
  AND (c.instance_type IN ('service', 'both'))
ON CONFLICT (category_id, use_case) DO NOTHING;


