-- Convert demo_instance_type from TEXT + CHECK to ENUM

BEGIN;

-- 1) Create enum type if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'demo_instance_type_enum') THEN
    CREATE TYPE demo_instance_type_enum AS ENUM ('industry', 'prospect');
  END IF;
END $$;

-- 2) Drop old check constraint if present
ALTER TABLE instances
DROP CONSTRAINT IF EXISTS instances_demo_instance_type_check;

-- 3) Alter column to use enum type
ALTER TABLE instances
ALTER COLUMN demo_instance_type TYPE demo_instance_type_enum USING (
  CASE
    WHEN demo_instance_type IS NULL THEN NULL
    ELSE demo_instance_type::demo_instance_type_enum
  END
);

-- 4) Ensure index exists (recreate is safe if type changed)
DROP INDEX IF EXISTS idx_instances_demo_flag_type;
CREATE INDEX IF NOT EXISTS idx_instances_demo_flag_type
ON instances (demo_instance, demo_instance_type);

COMMIT;


