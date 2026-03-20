-- Seed credit pricing for existing subcategories in the database
-- This will update all existing subcategories with appropriate credit prices

BEGIN;

-- First, let's see what subcategories exist by creating a temporary view
-- This helps us understand the current data structure

-- Update e-commerce subcategories (instance_type = 'ecomm') to lower credit prices
UPDATE categories_subcategories 
SET credit_price = 1
WHERE instance_type = 'ecomm' 
AND subcategory IN (
  'Furniture', 'Jewelry', 'Clothing'
);

-- Update service subcategories based on service value
-- Low-value services (2 credits)
UPDATE categories_subcategories 
SET credit_price = 2
WHERE instance_type = 'service' 
AND subcategory IN (
  'Paint'
);

-- Medium-value services (3 credits)  
UPDATE categories_subcategories 
SET credit_price = 3
WHERE instance_type = 'service' 
AND subcategory IN (
  'Flooring', 'Landscaping'
);

-- High-value services (4 credits)
UPDATE categories_subcategories 
SET credit_price = 4
WHERE instance_type = 'service' 
AND subcategory IN (
  'Interior Design'
);

-- Premium services (5 credits)
UPDATE categories_subcategories 
SET credit_price = 5
WHERE instance_type = 'service' 
AND subcategory IN (
  'Basements'
);

-- Set default credit price for any remaining NULL values
UPDATE categories_subcategories 
SET credit_price = 2
WHERE credit_price IS NULL;

COMMIT;
