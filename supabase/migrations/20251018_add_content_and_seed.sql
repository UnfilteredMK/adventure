BEGIN;

ALTER TABLE public.categories_subcategories
  ADD COLUMN IF NOT EXISTS content text;

-- Seed deterministic, keyword-rich content per active subcategory
CREATE OR REPLACE FUNCTION public._seed_content_for_subcategory(p_id uuid, p_sub text, p_keywords text[])
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  base text := trim(p_sub);
  kws text[] := coalesce(p_keywords, ARRAY[]::text[]);
  k1 text := array_to_string(kws[1:4], ', ');
  k2 text := array_to_string(kws[5:8], ', ');
  k3 text := array_to_string(kws[9:12], ', ');
  k4 text := array_to_string(kws[13:16], ', ');
  k5 text := array_to_string(kws[17:20], ', ');
  k6 text := array_to_string(kws[21:24], ', ');
BEGIN
  RETURN
    format('Use our AI %s design widget on your site for instant visuals: %s. ', base, coalesce(k1,'')) ||
    format('Let customers explore options and preview outcomes to boost engagement: %s. ', coalesce(k2,'')) ||
    format('Photorealistic mockups improve conversions and reduce returns: %s. ', coalesce(k3,'')) ||
    format('Upload photos or start from templates, then customize to match your brand: %s. ', coalesce(k4,'')) ||
    format('White‑label embed, analytics, and lead capture are built‑in: %s. ', coalesce(k5,'')) ||
    format('Optimized for search with relevant keywords so your %s pages rank: %s.', base, coalesce(k6,''));
END $$;

UPDATE public.categories_subcategories s
SET content = public._seed_content_for_subcategory(s.id, s.subcategory, s.seo_keywords)
WHERE s.status = 'active' AND (s.content IS NULL OR length(trim(s.content)) = 0);

COMMIT;


