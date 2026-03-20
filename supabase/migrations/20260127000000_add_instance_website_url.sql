-- Add instance-level website info

BEGIN;

ALTER TABLE instances
ADD COLUMN IF NOT EXISTS website_url TEXT;

COMMENT ON COLUMN instances.website_url IS 'User website URL associated with this instance.';

COMMIT;

