-- Migration: Add credit pricing columns to instances table
-- This migration adds credit_price, email_lead_price, and phone_lead_price columns
-- with proper defaults and constraints

-- Drop existing constraints if they exist (in case of re-runs)
ALTER TABLE instances DROP CONSTRAINT IF EXISTS check_credit_price_positive;
ALTER TABLE instances DROP CONSTRAINT IF EXISTS check_email_lead_price_positive;
ALTER TABLE instances DROP CONSTRAINT IF EXISTS check_phone_lead_price_positive;

-- Add credit_price column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'instances' AND column_name = 'credit_price') THEN
        ALTER TABLE instances ADD COLUMN credit_price INTEGER DEFAULT 1;
    END IF;
END $$;

-- Add email_lead_price column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'instances' AND column_name = 'email_lead_price') THEN
        ALTER TABLE instances ADD COLUMN email_lead_price INTEGER DEFAULT 30;
    END IF;
END $$;

-- Add phone_lead_price column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'instances' AND column_name = 'phone_lead_price') THEN
        ALTER TABLE instances ADD COLUMN phone_lead_price INTEGER DEFAULT 40;
    END IF;
END $$;

-- Update any NULL values with defaults (preserve existing non-NULL values)
UPDATE instances SET credit_price = 1 WHERE credit_price IS NULL;
UPDATE instances SET email_lead_price = 30 WHERE email_lead_price IS NULL;
UPDATE instances SET phone_lead_price = 40 WHERE phone_lead_price IS NULL;

-- Make columns NOT NULL
ALTER TABLE instances ALTER COLUMN credit_price SET NOT NULL;
ALTER TABLE instances ALTER COLUMN email_lead_price SET NOT NULL;
ALTER TABLE instances ALTER COLUMN phone_lead_price SET NOT NULL;

-- Add constraints to prevent zero or negative values
ALTER TABLE instances ADD CONSTRAINT check_credit_price_positive CHECK (credit_price > 0);
ALTER TABLE instances ADD CONSTRAINT check_email_lead_price_positive CHECK (email_lead_price > 0);
ALTER TABLE instances ADD CONSTRAINT check_phone_lead_price_positive CHECK (phone_lead_price > 0);

-- Verify the changes
SELECT 
    id, 
    name, 
    credit_price, 
    email_lead_price, 
    phone_lead_price 
FROM instances 
LIMIT 5;
