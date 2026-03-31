-- Undo the orphan "first subcategory by id" fallback and NOT NULL from 20260330160000 / 021.
-- Clears subcategory_id only where no image row links the prompt to a non-null subcategory.

ALTER TABLE public.prompts
  ALTER COLUMN subcategory_id DROP NOT NULL;

ALTER TABLE public.prompts
  DROP CONSTRAINT IF EXISTS prompts_subcategory_id_fkey;

ALTER TABLE public.prompts
  ADD CONSTRAINT prompts_subcategory_id_fkey
  FOREIGN KEY (subcategory_id)
  REFERENCES public.categories_subcategories (id)
  ON DELETE SET NULL;

UPDATE public.prompts p
SET subcategory_id = NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM public.images i
  WHERE i.prompt_id = p.id
    AND i.subcategory_id IS NOT NULL
);

COMMENT ON COLUMN public.prompts.subcategory_id IS 'Optional; set from images or explicitly. NULL when no image-derived subcategory.';
