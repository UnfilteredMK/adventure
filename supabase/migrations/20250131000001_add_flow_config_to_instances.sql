-- Add flow_config column to instances table for form mode configuration

BEGIN;

-- Add flow_config JSON column (nullable)
ALTER TABLE instances
ADD COLUMN IF NOT EXISTS flow_config JSONB;

-- Add comment to document the column
COMMENT ON COLUMN instances.flow_config IS 'Configuration for flow-based form mode. Separate from config (widget mode).';

COMMIT;
