-- Add instance-level company summary (generated from website)

BEGIN;

ALTER TABLE instances
ADD COLUMN IF NOT EXISTS company_summary TEXT;

COMMENT ON COLUMN instances.company_summary IS 'Short company summary generated from the instance website URL.';

COMMIT;

