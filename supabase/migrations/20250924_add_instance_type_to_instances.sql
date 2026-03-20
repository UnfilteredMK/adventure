-- Add instance_type column to instances with allowed values

BEGIN;

-- 1) Add the column if missing
ALTER TABLE instances
ADD COLUMN IF NOT EXISTS instance_type TEXT;

-- 2) Ensure we have a consistent default for new rows
ALTER TABLE instances
ALTER COLUMN instance_type SET DEFAULT 'service';

-- 3) Backfill existing rows that are NULL
UPDATE instances
SET instance_type = 'service'
WHERE instance_type IS NULL;

-- 4) Add or replace check constraint for allowed values
ALTER TABLE instances
DROP CONSTRAINT IF EXISTS instances_instance_type_check;

ALTER TABLE instances
ADD CONSTRAINT instances_instance_type_check
CHECK (instance_type IN ('ecomm', 'service'));

COMMIT;


