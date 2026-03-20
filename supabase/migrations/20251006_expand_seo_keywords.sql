BEGIN;

-- Expand seo_keywords to 12-18 tags per subcategory where currently short or NULL
UPDATE public.categories_subcategories AS cs
SET seo_keywords = (
  SELECT ARRAY(SELECT DISTINCT k FROM unnest(
    ARRAY[
      cs.subcategory,
      lower(cs.subcategory),
      cs.category_name,
      lower(cs.category_name),
      cs.subcategory || ' AI',
      cs.subcategory || ' visualization',
      cs.subcategory || ' preview',
      cs.subcategory || ' before and after',
      cs.subcategory || ' generator',
      'virtual ' || cs.subcategory,
      'online ' || cs.subcategory,
      'see it first ' || cs.subcategory,
      cs.subcategory || ' widget',
      cs.subcategory || ' tool',
      cs.subcategory || ' software',
      cs.subcategory || ' app',
      CASE WHEN cs.instance_type = 'ecomm' THEN cs.subcategory || ' shopping' ELSE cs.subcategory || ' booking' END,
      'customer visualization',
      'AI visualization'
    ]
  ) AS k WHERE k IS NOT NULL AND length(btrim(k)) > 1)
)
WHERE cs.status = 'active' AND (cs.seo_keywords IS NULL OR array_length(cs.seo_keywords,1) < 10);

COMMIT;


