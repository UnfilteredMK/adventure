-- Allow 'both' in instance_type across categories, categories_subcategories, and instances

BEGIN;

-- Update categories instance_type constraint to include 'both'
ALTER TABLE categories
DROP CONSTRAINT IF EXISTS categories_instance_type_check;
ALTER TABLE categories
ADD CONSTRAINT categories_instance_type_check
CHECK (instance_type IS NULL OR instance_type IN ('ecomm', 'service', 'both'));

-- Update categories_subcategories instance_type constraint to include 'both'
ALTER TABLE categories_subcategories
DROP CONSTRAINT IF EXISTS categories_subcategories_instance_type_check;
ALTER TABLE categories_subcategories
ADD CONSTRAINT categories_subcategories_instance_type_check
CHECK (instance_type IS NULL OR instance_type IN ('ecomm', 'service', 'both'));

-- Keep instances consistent as well
ALTER TABLE instances
DROP CONSTRAINT IF EXISTS instances_instance_type_check;
ALTER TABLE instances
ADD CONSTRAINT instances_instance_type_check
CHECK (instance_type IN ('ecomm', 'service', 'both'));

COMMIT;


