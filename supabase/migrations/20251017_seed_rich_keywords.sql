BEGIN;

-- Seed ~120 SEO keywords per active subcategory, tailored by subcategory and instance_type
-- Strategy: base generic keywords + category-specific augments built from subcategory text tokens

CREATE OR REPLACE FUNCTION public._gen_keywords(base text, inst text)
RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE
  tokens text[] := regexp_split_to_array(lower(base), '\\s+');
  words text[] := ARRAY[
    'ai', 'ai visualization', 'before after', 'generator', 'preview', 'mockup', 'virtual',
    'design', 'designer', 'image', 'image generation', 'widget', 'tool', 'online', 'app',
    'custom', 'branding', 'template', 'styles', 'options', 'photorealistic', 'high quality',
    'fast', 'instant', 'share', 'lead capture', 'embed', 'website', 'white label'
  ];
  combos text[] := ARRAY[]::text[];
  w text;
  t text;
BEGIN
  FOREACH w IN ARRAY words LOOP
    combos := combos || ARRAY[ base || ' ' || w, w || ' ' || base ];
  END LOOP;
  FOREACH t IN ARRAY tokens LOOP
    IF length(trim(t)) > 2 THEN
      combos := combos || ARRAY[
        t || ' ai', t || ' generator', t || ' preview', t || ' mockup', t || ' design', t || ' designer'
      ];
    END IF;
  END LOOP;
  IF inst = 'ecomm' OR inst = 'both' THEN
    combos := combos || ARRAY[
      base || ' product try on', base || ' ecommerce ai', base || ' shopping ai', base || ' conversion optimization'
    ];
  END IF;
  IF inst = 'service' OR inst = 'both' THEN
    combos := combos || ARRAY[
      base || ' contractor ai', base || ' visualization service', base || ' quote leads', base || ' booking boost'
    ];
  END IF;
  RETURN (SELECT ARRAY(SELECT DISTINCT x FROM unnest(combos) AS x WHERE length(trim(x)) > 2 LIMIT 140));
END; $$;

UPDATE public.categories_subcategories s
SET seo_keywords = (
  SELECT _gen_keywords(s.subcategory, coalesce(s.instance_type, 'both'))
)
WHERE s.status = 'active';

COMMIT;


