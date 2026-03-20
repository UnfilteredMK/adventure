-- Add question_templates column to categories_subcategories for flow mode questions

BEGIN;

-- Add question_templates JSONB column (nullable)
ALTER TABLE categories_subcategories
ADD COLUMN IF NOT EXISTS question_templates JSONB;

-- Add comment to document the column
COMMENT ON COLUMN categories_subcategories.question_templates IS 'Question templates for flow mode. Context-aware questions based on category/subcategory.';

COMMIT;
