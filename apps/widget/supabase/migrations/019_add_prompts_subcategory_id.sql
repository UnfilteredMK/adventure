-- Optional service-scoped link for suggestion labels and budget-step grouping (in addition to images.subcategory_id).
ALTER TABLE public.prompts
  ADD COLUMN IF NOT EXISTS subcategory_id uuid REFERENCES public.categories_subcategories (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS prompts_subcategory_id_idx
  ON public.prompts (subcategory_id)
  WHERE subcategory_id IS NOT NULL;

COMMENT ON COLUMN public.prompts.subcategory_id IS 'When set, ties the prompt to a service subcategory for chips and filtering without requiring an image row.';

-- One subcategory per prompt from images: use the most recent image row (ties broken by id).
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
