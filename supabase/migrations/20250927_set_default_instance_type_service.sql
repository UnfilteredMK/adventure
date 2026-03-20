-- Set all categories and categories_subcategories instance_type to 'service' initially
-- and set default to 'service' for future inserts

BEGIN;

-- Backfill existing NULLs to 'service'
UPDATE categories
SET instance_type = 'service'
WHERE instance_type IS NULL;

UPDATE categories_subcategories
SET instance_type = 'service'
WHERE instance_type IS NULL;

-- Set defaults to 'service' going forward
ALTER TABLE categories
ALTER COLUMN instance_type SET DEFAULT 'service';

ALTER TABLE categories_subcategories
ALTER COLUMN instance_type SET DEFAULT 'service';

COMMIT;


