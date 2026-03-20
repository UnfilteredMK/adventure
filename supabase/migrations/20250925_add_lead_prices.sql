-- Add lead pricing fields to instances and categories_subcategories

BEGIN;

-- Instances: add email_lead_price and phone_lead_price
ALTER TABLE instances
ADD COLUMN IF NOT EXISTS email_lead_price NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS phone_lead_price NUMERIC(10,2);

-- Ensure non-negative values if provided
ALTER TABLE instances
DROP CONSTRAINT IF EXISTS instances_email_lead_price_nonneg;
ALTER TABLE instances
ADD CONSTRAINT instances_email_lead_price_nonneg CHECK (email_lead_price IS NULL OR email_lead_price >= 0);

ALTER TABLE instances
DROP CONSTRAINT IF EXISTS instances_phone_lead_price_nonneg;
ALTER TABLE instances
ADD CONSTRAINT instances_phone_lead_price_nonneg CHECK (phone_lead_price IS NULL OR phone_lead_price >= 0);

-- Categories/Subcategories: add email_lead_price and phone_lead_price
ALTER TABLE categories_subcategories
ADD COLUMN IF NOT EXISTS email_lead_price NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS phone_lead_price NUMERIC(10,2);

ALTER TABLE categories_subcategories
DROP CONSTRAINT IF EXISTS cat_sub_email_lead_price_nonneg;
ALTER TABLE categories_subcategories
ADD CONSTRAINT cat_sub_email_lead_price_nonneg CHECK (email_lead_price IS NULL OR email_lead_price >= 0);

ALTER TABLE categories_subcategories
DROP CONSTRAINT IF EXISTS cat_sub_phone_lead_price_nonneg;
ALTER TABLE categories_subcategories
ADD CONSTRAINT cat_sub_phone_lead_price_nonneg CHECK (phone_lead_price IS NULL OR phone_lead_price >= 0);

COMMIT;


