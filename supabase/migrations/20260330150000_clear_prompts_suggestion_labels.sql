-- Remove auto-generated chip labels; content will backfill `suggestion_label` explicitly.
UPDATE public.prompts
SET suggestion_label = NULL
WHERE suggestion_label IS NOT NULL;
