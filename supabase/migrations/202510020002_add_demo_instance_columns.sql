-- Add demo flags to instances: demo_instance and demo_instance_type

BEGIN;

-- 1) Add demo_instance boolean flag (defaults to false)
ALTER TABLE instances
ADD COLUMN IF NOT EXISTS demo_instance BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) Add demo_instance_type with allowed values via check constraint
--    Allowed values: 'industry', 'prospect'
ALTER TABLE instances
ADD COLUMN IF NOT EXISTS demo_instance_type TEXT;

-- 3) Ensure check constraint exists and is up to date
ALTER TABLE instances
DROP CONSTRAINT IF EXISTS instances_demo_instance_type_check;

ALTER TABLE instances
ADD CONSTRAINT instances_demo_instance_type_check
CHECK (demo_instance_type IS NULL OR demo_instance_type IN ('industry', 'prospect'));

-- 4) Optional: composite index to speed up demo filtering
CREATE INDEX IF NOT EXISTS idx_instances_demo_flag_type
ON instances (demo_instance, demo_instance_type);

COMMIT;


