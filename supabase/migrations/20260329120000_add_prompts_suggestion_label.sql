-- Short UI label for suggestion chips; full refinement text remains in `prompt`.
ALTER TABLE public.prompts
ADD COLUMN IF NOT EXISTS suggestion_label text;

COMMENT ON COLUMN public.prompts.suggestion_label IS 'Short label for suggestion chips; `prompt` holds the full refinement sent on apply.';
