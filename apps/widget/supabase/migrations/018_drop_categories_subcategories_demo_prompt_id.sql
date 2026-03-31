-- Prompts are linked to subcategories via gallery `images` (prompt_id + subcategory_id), not a direct FK on categories_subcategories.
ALTER TABLE public.categories_subcategories
  DROP CONSTRAINT IF EXISTS categories_subcategories_demo_prompt_id_fkey;

ALTER TABLE public.categories_subcategories
  DROP COLUMN IF EXISTS demo_prompt_id;
