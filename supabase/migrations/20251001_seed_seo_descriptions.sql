-- Seed SEO descriptions for categories and subcategories (renamed to latest timestamp to avoid ordering conflicts)
BEGIN;

-- Categories: fill empty descriptions with SEO-friendly defaults based on instance_type
UPDATE categories
SET description = CASE
  WHEN instance_type = 'ecomm' THEN 'AI visualization tools for ' || name || ' products. Help shoppers preview before buying.'
  WHEN instance_type = 'service' THEN 'AI visualization tools for ' || name || ' services. Let clients see outcomes before booking.'
  WHEN instance_type = 'both' THEN 'AI visualization tools for ' || name || ' across e-commerce and services.'
  ELSE 'AI visualization tools for ' || name || '.'
END
WHERE (description IS NULL OR length(trim(description)) = 0);

-- Subcategories: fill empty descriptions with SEO-friendly defaults based on instance_type
UPDATE categories_subcategories
SET description = CASE
  WHEN instance_type = 'ecomm' THEN 'AI visualization for ' || subcategory || ' products. Let shoppers preview items before purchase.'
  WHEN instance_type = 'service' THEN 'AI visualization for ' || subcategory || ' services. Let clients preview outcomes before booking.'
  WHEN instance_type = 'both' THEN 'AI visualization for ' || subcategory || ' across e-commerce and services.'
  ELSE 'AI visualization for ' || subcategory || '.'
END
WHERE (description IS NULL OR length(trim(description)) = 0);

COMMIT;


