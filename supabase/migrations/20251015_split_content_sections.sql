BEGIN;

-- Add structured content columns
ALTER TABLE public.categories_subcategories
  ADD COLUMN IF NOT EXISTS who_benefits text,
  ADD COLUMN IF NOT EXISTS why_it_ranks text,
  ADD COLUMN IF NOT EXISTS why_with_ai text,
  ADD COLUMN IF NOT EXISTS built_for text;

-- Optionally backfill from content_md if present (extract rough sections by markers)
-- Keep lightweight to avoid regex complexity in SQL
-- No-op here; content will be curated manually via Studio.

COMMIT;


