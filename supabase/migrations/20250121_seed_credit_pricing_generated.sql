-- Seed credit pricing for existing subcategories
-- Generated automatically from database

BEGIN;

-- Set default credit price for any remaining NULL values
UPDATE categories_subcategories 
SET credit_price = 2
WHERE credit_price IS NULL;

COMMIT;
