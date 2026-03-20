-- Create category_use_cases table to map categories to standard use cases and model profiles
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'use_case_type') THEN
    CREATE TYPE use_case_type AS ENUM ('tryon', 'scene');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.category_use_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  use_case use_case_type NOT NULL,
  ai_model_profile text NULL,
  metadata jsonb NULL DEFAULT '{}'::jsonb,
  CONSTRAINT category_use_cases_unique UNIQUE (category_id, use_case)
);


