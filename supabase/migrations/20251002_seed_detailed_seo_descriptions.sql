-- Fill SEO descriptions for every category and subcategory, tailored by instance_type
-- Safe: only populates when description is NULL or empty
BEGIN;

-- Categories: specific copy per instance_type
UPDATE public.categories AS c
SET description = (
  CASE c.instance_type
    WHEN 'ecomm' THEN
      'Adventure AI visualization for ' || c.name || ' products. Let shoppers preview items before purchase to boost confidence and reduce returns.'
    WHEN 'service' THEN
      'Adventure AI visualization for ' || c.name || ' services. Let clients preview outcomes before booking to increase bookings and satisfaction.'
    WHEN 'both' THEN
      'Adventure AI visualization for ' || c.name || ' across e‑commerce and services. Help customers preview before purchase or booking to improve conversions.'
    ELSE
      'Adventure AI visualization for ' || c.name || '. Help customers preview results to make better decisions.'
  END
)
WHERE (c.description IS NULL OR length(btrim(c.description)) = 0);

-- Subcategories: specific copy mentioning both subcategory and category
UPDATE public.categories_subcategories AS cs
SET description = (
  CASE cs.instance_type
    WHEN 'ecomm' THEN
      'Adventure AI visualization for ' || cs.subcategory || ' in ' || COALESCE(cs.category_name, '') || ' e‑commerce. Let shoppers preview items to increase conversions and reduce returns.'
    WHEN 'service' THEN
      'Adventure AI visualization for ' || cs.subcategory || ' in ' || COALESCE(cs.category_name, '') || ' services. Let clients preview outcomes before booking to boost confidence and bookings.'
    WHEN 'both' THEN
      'Adventure AI visualization for ' || cs.subcategory || ' in ' || COALESCE(cs.category_name, '') || ' (e‑commerce and services). Preview before purchase or booking to improve decisions.'
    ELSE
      'Adventure AI visualization for ' || cs.subcategory || ' in ' || COALESCE(cs.category_name, '') || '. Help customers preview results to make better choices.'
  END
)
WHERE (cs.description IS NULL OR length(btrim(cs.description)) = 0);

COMMIT;

