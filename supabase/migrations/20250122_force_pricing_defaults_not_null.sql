-- FORCE pricing defaults and NOT NULL constraints
-- This migration aggressively fixes all NULL values and ensures they never happen again

BEGIN;

-- =============================================
-- INSTANCES TABLE - FORCE DEFAULTS
-- =============================================

-- First, update ALL NULL values with proper defaults
UPDATE instances 
SET credit_price = 1 
WHERE credit_price IS NULL;

UPDATE instances 
SET email_lead_price = 30.00 
WHERE email_lead_price IS NULL;

UPDATE instances 
SET phone_lead_price = 40.00 
WHERE phone_lead_price IS NULL;

-- Add DEFAULT values to column definitions
ALTER TABLE instances 
ALTER COLUMN credit_price SET DEFAULT 1;

ALTER TABLE instances 
ALTER COLUMN email_lead_price SET DEFAULT 30.00;

ALTER TABLE instances 
ALTER COLUMN phone_lead_price SET DEFAULT 40.00;

-- Add NOT NULL constraints
ALTER TABLE instances 
ALTER COLUMN credit_price SET NOT NULL;

ALTER TABLE instances 
ALTER COLUMN email_lead_price SET NOT NULL;

ALTER TABLE instances 
ALTER COLUMN phone_lead_price SET NOT NULL;

-- Add check constraints to ensure positive values
ALTER TABLE instances 
DROP CONSTRAINT IF EXISTS check_instances_credit_price_positive;

ALTER TABLE instances 
ADD CONSTRAINT check_instances_credit_price_positive 
CHECK (credit_price > 0);

ALTER TABLE instances 
DROP CONSTRAINT IF EXISTS check_instances_email_lead_price_positive;

ALTER TABLE instances 
ADD CONSTRAINT check_instances_email_lead_price_positive 
CHECK (email_lead_price > 0);

ALTER TABLE instances 
DROP CONSTRAINT IF EXISTS check_instances_phone_lead_price_positive;

ALTER TABLE instances 
ADD CONSTRAINT check_instances_phone_lead_price_positive 
CHECK (phone_lead_price > 0);

-- =============================================
-- CATEGORIES_SUBCATEGORIES TABLE - FORCE DEFAULTS
-- =============================================

-- First, update ALL NULL values with proper defaults
UPDATE categories_subcategories 
SET credit_price = 1 
WHERE credit_price IS NULL;

UPDATE categories_subcategories 
SET email_lead_price = 30.00 
WHERE email_lead_price IS NULL;

UPDATE categories_subcategories 
SET phone_lead_price = 40.00 
WHERE phone_lead_price IS NULL;

-- Add DEFAULT values to column definitions
ALTER TABLE categories_subcategories 
ALTER COLUMN credit_price SET DEFAULT 1;

ALTER TABLE categories_subcategories 
ALTER COLUMN email_lead_price SET DEFAULT 30.00;

ALTER TABLE categories_subcategories 
ALTER COLUMN phone_lead_price SET DEFAULT 40.00;

-- Add NOT NULL constraints
ALTER TABLE categories_subcategories 
ALTER COLUMN credit_price SET NOT NULL;

ALTER TABLE categories_subcategories 
ALTER COLUMN email_lead_price SET NOT NULL;

ALTER TABLE categories_subcategories 
ALTER COLUMN phone_lead_price SET NOT NULL;

-- Add check constraints to ensure positive values
ALTER TABLE categories_subcategories 
DROP CONSTRAINT IF EXISTS check_cat_sub_credit_price_positive;

ALTER TABLE categories_subcategories 
ADD CONSTRAINT check_cat_sub_credit_price_positive 
CHECK (credit_price > 0);

ALTER TABLE categories_subcategories 
DROP CONSTRAINT IF EXISTS check_cat_sub_email_lead_price_positive;

ALTER TABLE categories_subcategories 
ADD CONSTRAINT check_cat_sub_email_lead_price_positive 
CHECK (email_lead_price > 0);

ALTER TABLE categories_subcategories 
DROP CONSTRAINT IF EXISTS check_cat_sub_phone_lead_price_positive;

ALTER TABLE categories_subcategories 
ADD CONSTRAINT check_cat_sub_phone_lead_price_positive 
CHECK (phone_lead_price > 0);

-- =============================================
-- CLEANUP OLD CONSTRAINTS
-- =============================================

-- Remove old non-negative constraints that allowed NULL values
ALTER TABLE instances 
DROP CONSTRAINT IF EXISTS instances_credit_price_nonneg;

ALTER TABLE instances 
DROP CONSTRAINT IF EXISTS instances_email_lead_price_nonneg;

ALTER TABLE instances 
DROP CONSTRAINT IF EXISTS instances_phone_lead_price_nonneg;

ALTER TABLE categories_subcategories 
DROP CONSTRAINT IF EXISTS cat_sub_credit_price_nonneg;

ALTER TABLE categories_subcategories 
DROP CONSTRAINT IF EXISTS cat_sub_email_lead_price_nonneg;

ALTER TABLE categories_subcategories 
DROP CONSTRAINT IF EXISTS cat_sub_phone_lead_price_nonneg;

-- =============================================
-- VERIFICATION QUERIES (for debugging)
-- =============================================

-- These will show any remaining NULL values (should be 0)
-- SELECT 'instances' as table_name, 'credit_price' as column_name, COUNT(*) as null_count FROM instances WHERE credit_price IS NULL
-- UNION ALL
-- SELECT 'instances', 'email_lead_price', COUNT(*) FROM instances WHERE email_lead_price IS NULL
-- UNION ALL
-- SELECT 'instances', 'phone_lead_price', COUNT(*) FROM instances WHERE phone_lead_price IS NULL
-- UNION ALL
-- SELECT 'categories_subcategories', 'credit_price', COUNT(*) FROM categories_subcategories WHERE credit_price IS NULL
-- UNION ALL
-- SELECT 'categories_subcategories', 'email_lead_price', COUNT(*) FROM categories_subcategories WHERE email_lead_price IS NULL
-- UNION ALL
-- SELECT 'categories_subcategories', 'phone_lead_price', COUNT(*) FROM categories_subcategories WHERE phone_lead_price IS NULL;

COMMIT;
