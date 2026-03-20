BEGIN;

-- Add SEO columns to subcategories
ALTER TABLE public.categories_subcategories
  ADD COLUMN IF NOT EXISTS seo_title text,
  ADD COLUMN IF NOT EXISTS seo_description text,
  ADD COLUMN IF NOT EXISTS seo_keywords text[],
  ADD COLUMN IF NOT EXISTS canonical_path text,
  ADD COLUMN IF NOT EXISTS noindex boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS og_title text,
  ADD COLUMN IF NOT EXISTS og_description text,
  ADD COLUMN IF NOT EXISTS og_image_url text,
  ADD COLUMN IF NOT EXISTS twitter_image_url text,
  ADD COLUMN IF NOT EXISTS h1 text,
  ADD COLUMN IF NOT EXISTS hero_tagline text,
  ADD COLUMN IF NOT EXISTS hero_cta_text text,
  ADD COLUMN IF NOT EXISTS hero_cta_url text,
  ADD COLUMN IF NOT EXISTS content_md text,
  ADD COLUMN IF NOT EXISTS faq jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sample_images jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS schema_type text DEFAULT 'Product',
  ADD COLUMN IF NOT EXISTS schema_props jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS slug_override text,
  ADD COLUMN IF NOT EXISTS priority smallint,
  ADD COLUMN IF NOT EXISTS last_reviewed_at timestamptz;

-- Optional category-level defaults
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS default_seo_title text,
  ADD COLUMN IF NOT EXISTS default_seo_description text,
  ADD COLUMN IF NOT EXISTS default_og_image_url text;

-- Seed subcategory SEO fields where empty
UPDATE public.categories_subcategories AS cs
SET 
  seo_title = COALESCE(cs.seo_title, cs.subcategory || ' | Adventure'),
  seo_description = COALESCE(
    cs.seo_description,
    CASE cs.instance_type
      WHEN 'ecomm' THEN 'Adventure AI visualization for ' || cs.subcategory || ' products. Let shoppers preview items to boost conversions.'
      WHEN 'service' THEN 'Adventure AI visualization for ' || cs.subcategory || ' services. Let clients preview outcomes to increase bookings.'
      ELSE 'Adventure AI visualization for ' || cs.subcategory || ' across e‑commerce and services.'
    END
  ),
  seo_keywords = COALESCE(cs.seo_keywords, ARRAY[cs.subcategory, 'AI visualization', 'Adventure']),
  og_title = COALESCE(cs.og_title, cs.seo_title),
  og_description = COALESCE(cs.og_description, cs.seo_description),
  h1 = COALESCE(cs.h1, cs.subcategory),
  hero_tagline = COALESCE(cs.hero_tagline, 'Preview before you commit'),
  hero_cta_text = COALESCE(cs.hero_cta_text, 'Start Free Trial'),
  hero_cta_url = COALESCE(cs.hero_cta_url, '/auth'),
  schema_type = COALESCE(cs.schema_type, 'Product'),
  last_reviewed_at = NOW()
WHERE TRUE;

COMMIT;

