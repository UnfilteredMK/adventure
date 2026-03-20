-- Migration: Fix user_subscriptions status constraint to allow 'trialing' status
BEGIN;

-- First, drop the existing constraint if it exists
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE table_name = 'user_subscriptions' AND constraint_name = 'user_subscriptions_status_check'
    ) THEN
        ALTER TABLE user_subscriptions DROP CONSTRAINT user_subscriptions_status_check;
    END IF;
END $$;

-- Add the new constraint with all valid status values including 'trialing'
ALTER TABLE user_subscriptions
    ADD CONSTRAINT user_subscriptions_status_check 
    CHECK (status IN ('active', 'canceled', 'past_due', 'inactive', 'trialing') OR status IS NULL);

COMMIT; 