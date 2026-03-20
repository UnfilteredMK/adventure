BEGIN;

-- Helper: split string into tokens (length >= 3)
CREATE OR REPLACE FUNCTION public._tokens_3(p_text text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT lower(x)
      FROM regexp_split_to_table(coalesce(p_text,''), '[^a-zA-Z0-9]+') AS x
      WHERE length(x) >= 3
    ), ARRAY[]::text[]
  );
$$;

-- Helper: choose relevant keywords by preferring ones that include subcategory tokens and de-prioritizing generic terms
CREATE OR REPLACE FUNCTION public._select_relevant_keywords(p_sub text, p_keywords text[])
RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE
  sub_tokens text[] := public._tokens_3(p_sub);
  generic text[] := ARRAY['ai','ai visualization','generator','widget','tool','online','preview','mockup'];
  preferred text[] := ARRAY[]::text[];
  others text[] := ARRAY[]::text[];
  k text;
  lowerk text;
  t text;
  is_generic boolean;
  matches boolean;
BEGIN
  IF p_keywords IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;
  FOREACH k IN ARRAY p_keywords LOOP
    lowerk := lower(trim(k));
    IF lowerk = '' THEN CONTINUE; END IF;
    -- generic check
    is_generic := false;
    FOREACH t IN ARRAY generic LOOP
      IF lowerk = t THEN is_generic := true; EXIT; END IF;
    END LOOP;
    -- token match check
    matches := false;
    FOREACH t IN ARRAY sub_tokens LOOP
      IF position(t in lowerk) > 0 THEN matches := true; EXIT; END IF;
    END LOOP;
    IF matches AND NOT is_generic THEN
      preferred := array_append(preferred, k);
    ELSE
      others := array_append(others, k);
    END IF;
  END LOOP;
  -- Limit size and combine: up to 8 from preferred, then up to 4 from others
  RETURN COALESCE(preferred[1:8], ARRAY[]::text[]) || COALESCE(others[1:4], ARRAY[]::text[]);
END $$;

-- Builder: ~30 word, human-sounding, keyword-laced tagline (2 short sentences)
CREATE OR REPLACE FUNCTION public._build_hero_tagline_v2(p_sub text, p_inst text, p_keywords text[])
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  base text := trim(p_sub);
  chosen text[] := public._select_relevant_keywords(p_sub, p_keywords);
  k1 text := array_to_string(chosen[1:3], ', ');
  k2 text := array_to_string(chosen[4:6], ', ');
  s1 text;
  s2 text;
BEGIN
  s1 := format('Show realistic %s results on your site with our white‑label, embedded AI — %s.', base, coalesce(k1,''));
  IF coalesce(p_inst,'both') IN ('ecomm') THEN
    s2 := format('Boost conversions with fast try‑ons and brand‑ready outputs for %s.', coalesce(k2,''));
  ELSIF coalesce(p_inst,'both') IN ('service') THEN
    s2 := format('Win more leads with instant previews and clear expectations for %s.', coalesce(k2,''));
  ELSE
    s2 := format('Engage visitors and convert with instant previews and lead capture for %s.', coalesce(k2,''));
  END IF;
  RETURN trim(s1 || ' ' || s2);
END $$;

-- Update: only taglines that are short (< 25 words) get expanded to ~30 words
UPDATE public.categories_subcategories s
SET hero_tagline = public._build_hero_tagline_v2(s.subcategory, coalesce(s.instance_type,'both'), s.seo_keywords)
WHERE s.status = 'active'
  AND (
    s.hero_tagline IS NULL
    OR array_length(regexp_split_to_array(s.hero_tagline, '\\s+'),1) < 25
  );

COMMIT;


