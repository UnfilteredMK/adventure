-- Migration to update the foreign key constraint on images.subcategory_id
-- to have proper CASCADE behavior when categories_subcategories rows are deleted

BEGIN;

-- First, drop the existing foreign key constraint
ALTER TABLE images 
DROP CONSTRAINT IF EXISTS images_subcategory_id_fkey;

-- Recreate the foreign key constraint with CASCADE behavior
-- This means when a row in categories_subcategories is deleted,
-- all related rows in images will also be deleted
ALTER TABLE images 
ADD CONSTRAINT images_subcategory_id_fkey 
FOREIGN KEY (subcategory_id) 
REFERENCES categories_subcategories(id) 
ON DELETE CASCADE;

COMMIT;
