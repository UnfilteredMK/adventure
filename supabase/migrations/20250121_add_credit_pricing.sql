-- Add credit pricing fields to instances and categories_subcategories

BEGIN;

-- Instances: add credit_price column
ALTER TABLE instances
ADD COLUMN IF NOT EXISTS credit_price INTEGER;

-- Ensure non-negative values if provided
ALTER TABLE instances
DROP CONSTRAINT IF EXISTS instances_credit_price_nonneg;
ALTER TABLE instances
ADD CONSTRAINT instances_credit_price_nonneg CHECK (credit_price IS NULL OR credit_price >= 0);

-- Categories/Subcategories: add credit_price column
ALTER TABLE categories_subcategories
ADD COLUMN IF NOT EXISTS credit_price INTEGER;

ALTER TABLE categories_subcategories
DROP CONSTRAINT IF EXISTS cat_sub_credit_price_nonneg;
ALTER TABLE categories_subcategories
ADD CONSTRAINT cat_sub_credit_price_nonneg CHECK (credit_price IS NULL OR credit_price >= 0);

COMMIT;
