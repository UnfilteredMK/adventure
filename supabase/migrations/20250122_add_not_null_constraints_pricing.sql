-- Add NOT NULL constraints with default values for pricing columns
-- This migration ensures all pricing columns have minimum values and cannot be NULL

BEGIN;

-- =============================================
-- INSTANCES TABLE
-- =============================================

-- Set default values for NULL entries in instances table
UPDATE instances 
SET credit_price = 1 
WHERE credit_price IS NULL;

UPDATE instances 
SET email_lead_price = 30.00 
WHERE email_lead_price IS NULL;

UPDATE instances 
SET phone_lead_price = 40.00 
WHERE phone_lead_price IS NULL;

-- Add NOT NULL constraints to instances table
ALTER TABLE instances 
ALTER COLUMN credit_price SET NOT NULL;

ALTER TABLE instances 
ALTER COLUMN email_lead_price SET NOT NULL;

ALTER TABLE instances 
ALTER COLUMN phone_lead_price SET NOT NULL;

-- Add check constraints to ensure positive values for instances
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
-- CATEGORIES_SUBCATEGORIES TABLE
-- =============================================

-- Set default values for NULL entries in categories_subcategories table
UPDATE categories_subcategories 
SET credit_price = 1 
WHERE credit_price IS NULL;

UPDATE categories_subcategories 
SET email_lead_price = 30.00 
WHERE email_lead_price IS NULL;

UPDATE categories_subcategories 
SET phone_lead_price = 40.00 
WHERE phone_lead_price IS NULL;

-- Add NOT NULL constraints to categories_subcategories table
ALTER TABLE categories_subcategories 
ALTER COLUMN credit_price SET NOT NULL;

ALTER TABLE categories_subcategories 
ALTER COLUMN email_lead_price SET NOT NULL;

ALTER TABLE categories_subcategories 
ALTER COLUMN phone_lead_price SET NOT NULL;

-- Add check constraints to ensure positive values for categories_subcategories
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

COMMIT;
