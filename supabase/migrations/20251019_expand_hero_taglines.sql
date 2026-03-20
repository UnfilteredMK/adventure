BEGIN;

-- Expand short hero_tagline values (null or < 15 words) to ~30–50 words using seo_keywords
CREATE OR REPLACE FUNCTION public._build_hero_tagline(p_sub text, p_keywords text[])
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  base text := trim(p_sub);
  kws text[] := coalesce(p_keywords, ARRAY[]::text[]);
  k text := array_to_string(kws[1:6], ', ');
  k2 text := array_to_string(kws[7:12], ', ');
  line text;
BEGIN
  line := format('%s AI previews for %s — fast, realistic, and on‑brand. ', base, base);
  line := line || format('Help visitors explore options, set expectations, and convert with confidence (%s). ', coalesce(k,''));
  line := line || format('Easy embed, white‑label controls, and lead capture built‑in (%s).', coalesce(k2,''));
  RETURN trim(line);
END $$;

UPDATE public.categories_subcategories s
SET hero_tagline = public._build_hero_tagline(s.subcategory, s.seo_keywords)
WHERE s.status = 'active'
  AND (s.hero_tagline IS NULL OR array_length(regexp_split_to_array(s.hero_tagline, '\\s+'),1) < 15);

COMMIT;


