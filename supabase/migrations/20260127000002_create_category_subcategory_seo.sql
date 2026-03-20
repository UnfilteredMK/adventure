-- Split SEO/marketing fields out of categories_subcategories.
-- Creates a 1:1 table category_subcategory_seo, backfills existing data,
-- then drops the SEO/hero/content columns from categories_subcategories.

BEGIN;

CREATE TABLE IF NOT EXISTS public.category_subcategory_seo (
  category_subcategory_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),

  -- SEO
  seo_title text NULL,
  seo_description text NULL,
  seo_keywords text[] NULL,
  canonical_path text NULL,
  noindex boolean NULL DEFAULT false,

  -- Social meta
  og_title text NULL,
  og_description text NULL,
  og_image_url text NULL,
  twitter_image_url text NULL,

  -- Page hero/content
  h1 text NULL,
  hero_tagline text NULL,
  hero_cta_text text NULL,
  hero_cta_url text NULL,
  content text NULL,

  -- Rich content helpers
  faq jsonb NULL DEFAULT '[]'::jsonb,
  sample_images jsonb NULL DEFAULT '[]'::jsonb,
  schema_type text NULL DEFAULT 'Product'::text,
  schema_props jsonb NULL DEFAULT '{}'::jsonb,
  priority smallint NULL,
  last_reviewed_at timestamptz NULL,

  CONSTRAINT category_subcategory_seo_pkey PRIMARY KEY (category_subcategory_id),
  CONSTRAINT category_subcategory_seo_category_subcategory_id_fkey
    FOREIGN KEY (category_subcategory_id)
    REFERENCES public.categories_subcategories (id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.category_subcategory_seo IS 'SEO/marketing fields for a categories_subcategories row (1:1).';

-- Keep updated_at current.
DROP TRIGGER IF EXISTS category_subcategory_seo_updated_at ON public.category_subcategory_seo;
CREATE TRIGGER category_subcategory_seo_updated_at
BEFORE UPDATE ON public.category_subcategory_seo
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- Backfill from existing columns (idempotent).
INSERT INTO public.category_subcategory_seo (
  category_subcategory_id,
  seo_title,
  seo_description,
  seo_keywords,
  canonical_path,
  noindex,
  og_title,
  og_description,
  og_image_url,
  twitter_image_url,
  h1,
  hero_tagline,
  hero_cta_text,
  hero_cta_url,
  content,
  faq,
  sample_images,
  schema_type,
  schema_props,
  priority,
  last_reviewed_at
)
SELECT
  cs.id,
  cs.seo_title,
  cs.seo_description,
  cs.seo_keywords,
  cs.canonical_path,
  cs.noindex,
  cs.og_title,
  cs.og_description,
  cs.og_image_url,
  cs.twitter_image_url,
  cs.h1,
  cs.hero_tagline,
  cs.hero_cta_text,
  cs.hero_cta_url,
  cs.content,
  cs.faq,
  cs.sample_images,
  cs.schema_type,
  cs.schema_props,
  cs.priority,
  cs.last_reviewed_at
FROM public.categories_subcategories cs
ON CONFLICT (category_subcategory_id) DO UPDATE SET
  seo_title = EXCLUDED.seo_title,
  seo_description = EXCLUDED.seo_description,
  seo_keywords = EXCLUDED.seo_keywords,
  canonical_path = EXCLUDED.canonical_path,
  noindex = EXCLUDED.noindex,
  og_title = EXCLUDED.og_title,
  og_description = EXCLUDED.og_description,
  og_image_url = EXCLUDED.og_image_url,
  twitter_image_url = EXCLUDED.twitter_image_url,
  h1 = EXCLUDED.h1,
  hero_tagline = EXCLUDED.hero_tagline,
  hero_cta_text = EXCLUDED.hero_cta_text,
  hero_cta_url = EXCLUDED.hero_cta_url,
  content = EXCLUDED.content,
  faq = EXCLUDED.faq,
  sample_images = EXCLUDED.sample_images,
  schema_type = EXCLUDED.schema_type,
  schema_props = EXCLUDED.schema_props,
  priority = EXCLUDED.priority,
  last_reviewed_at = EXCLUDED.last_reviewed_at,
  updated_at = timezone('utc'::text, now());

-- Drop SEO/hero/content columns from categories_subcategories (keep slug and operational fields).
ALTER TABLE public.categories_subcategories
  DROP COLUMN IF EXISTS canonical_path,
  DROP COLUMN IF EXISTS content,
  DROP COLUMN IF EXISTS faq,
  DROP COLUMN IF EXISTS h1,
  DROP COLUMN IF EXISTS hero_cta_text,
  DROP COLUMN IF EXISTS hero_cta_url,
  DROP COLUMN IF EXISTS hero_tagline,
  DROP COLUMN IF EXISTS last_reviewed_at,
  DROP COLUMN IF EXISTS noindex,
  DROP COLUMN IF EXISTS og_description,
  DROP COLUMN IF EXISTS og_image_url,
  DROP COLUMN IF EXISTS og_title,
  DROP COLUMN IF EXISTS priority,
  DROP COLUMN IF EXISTS sample_images,
  DROP COLUMN IF EXISTS schema_props,
  DROP COLUMN IF EXISTS schema_type,
  DROP COLUMN IF EXISTS seo_description,
  DROP COLUMN IF EXISTS seo_keywords,
  DROP COLUMN IF EXISTS seo_title,
  DROP COLUMN IF EXISTS twitter_image_url;

COMMIT;

