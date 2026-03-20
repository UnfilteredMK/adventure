-- Add enum type for use cases if not exists, then add column to instances
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'use_case_type') THEN
    CREATE TYPE use_case_type AS ENUM ('tryon', 'scene');
  END IF;
END
$$;

ALTER TABLE public.instances
ADD COLUMN IF NOT EXISTS use_case use_case_type NULL;


