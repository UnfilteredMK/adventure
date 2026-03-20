-- Add instance_type to categories and categories_subcategories for filtering (ecomm|service)

BEGIN;

-- Categories
ALTER TABLE categories
ADD COLUMN IF NOT EXISTS instance_type TEXT;

ALTER TABLE categories
DROP CONSTRAINT IF EXISTS categories_instance_type_check;
ALTER TABLE categories
ADD CONSTRAINT categories_instance_type_check
CHECK (instance_type IS NULL OR instance_type IN ('ecomm', 'service'));

-- Categories Subcategories
ALTER TABLE categories_subcategories
ADD COLUMN IF NOT EXISTS instance_type TEXT;

ALTER TABLE categories_subcategories
DROP CONSTRAINT IF EXISTS categories_subcategories_instance_type_check;
ALTER TABLE categories_subcategories
ADD CONSTRAINT categories_subcategories_instance_type_check
CHECK (instance_type IS NULL OR instance_type IN ('ecomm', 'service'));

COMMIT;


