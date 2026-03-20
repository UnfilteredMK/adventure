-- Backfill: ensure every category has at least one subcategory

BEGIN;

INSERT INTO categories_subcategories (
  subcategory,
  description,
  category_id,
  category_name,
  status,
  instance_type,
  account_id
)
SELECT
  'General ' || c.name AS subcategory,
  NULL AS description,
  c.id AS category_id,
  c.name AS category_name,
  'active' AS status,
  COALESCE(c.instance_type, 'service') AS instance_type,
  NULL AS account_id
FROM categories c
WHERE NOT EXISTS (
  SELECT 1 FROM categories_subcategories cs WHERE cs.category_id = c.id
);

COMMIT;


