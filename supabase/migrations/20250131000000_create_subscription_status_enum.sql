-- Migration: Create subscription_status enum and update user_subscriptions.status column
BEGIN;

-- Create the enum type for subscription status
CREATE TYPE status AS ENUM (
  'active',
  'canceled',
  'past_due',
  'inactive',
  'trialing',
  'unpaid'
);

-- Drop the existing CHECK constraint if it exists
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name = 'user_subscriptions' 
        AND constraint_name = 'user_subscriptions_status_check'
    ) THEN
        ALTER TABLE user_subscriptions DROP CONSTRAINT user_subscriptions_status_check;
    END IF;
END $$;

-- Update any NULL or invalid status values to 'inactive' (default)
UPDATE user_subscriptions 
SET status = 'inactive'
WHERE status IS NULL 
   OR status NOT IN ('active', 'canceled', 'past_due', 'inactive', 'trialing', 'unpaid');

-- Drop any existing default first
ALTER TABLE user_subscriptions 
  ALTER COLUMN status DROP DEFAULT;

-- Drop indexes that reference the status column
DO $$ 
DECLARE
    idx_record RECORD;
BEGIN
    FOR idx_record IN 
        SELECT indexname 
        FROM pg_indexes 
        WHERE tablename = 'user_subscriptions' 
        AND indexdef LIKE '%status%'
    LOOP
        EXECUTE 'DROP INDEX IF EXISTS ' || quote_ident(idx_record.indexname);
    END LOOP;
END $$;

-- Alter the column type to use the enum
ALTER TABLE user_subscriptions 
  ALTER COLUMN status TYPE status 
  USING status::status;

-- Set default value (must be done separately after type conversion)
ALTER TABLE user_subscriptions 
  ALTER COLUMN status SET DEFAULT 'inactive'::status;

-- Make NOT NULL
ALTER TABLE user_subscriptions 
  ALTER COLUMN status SET NOT NULL;

-- Recreate index on status column if it was dropped
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status 
ON user_subscriptions (status);

COMMIT;

