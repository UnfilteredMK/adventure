-- Backfill null use_case to a safe default, then enforce NOT NULL
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'use_case_type') THEN
    CREATE TYPE use_case_type AS ENUM ('tryon', 'scene');
  END IF;
END
$$;

UPDATE public.instances
SET use_case = 'scene'::use_case_type
WHERE use_case IS NULL;

ALTER TABLE public.instances
ALTER COLUMN use_case SET NOT NULL;


