-- Supersedes earlier NOT NULL + orphan fallback (removed).
-- Image-derived backfill only (idempotent; same rule as 019_add_prompts_subcategory_id.sql).
UPDATE public.prompts p
SET subcategory_id = s.subcategory_id
FROM (
  SELECT DISTINCT ON (i.prompt_id)
    i.prompt_id,
    i.subcategory_id
  FROM public.images i
  WHERE i.prompt_id IS NOT NULL
    AND i.subcategory_id IS NOT NULL
  ORDER BY i.prompt_id, i.created_at DESC NULLS LAST, i.id ASC
) s
WHERE p.id = s.prompt_id;
