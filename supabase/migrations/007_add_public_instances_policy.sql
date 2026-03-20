-- Add public read policy for instances table
-- This allows the widget to read instance data without authentication

-- Enable RLS on instances table if not already enabled
ALTER TABLE instances ENABLE ROW LEVEL SECURITY;

-- Drop any existing public policies to avoid conflicts
DROP POLICY IF EXISTS "Public can read instances" ON instances;

-- Create public read policy for instances
CREATE POLICY "Public can read instances" ON instances
    FOR SELECT USING (true);

-- This policy allows anyone to read instance data, which is needed for the widget
-- The widget uses the instance ID from the URL to load configuration 