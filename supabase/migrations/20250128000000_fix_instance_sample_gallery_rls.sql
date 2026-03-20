-- Fix RLS policies for instance_sample_gallery table
-- Drop existing policies that might be causing the error
DROP POLICY IF EXISTS "Users can view their own instance sample gallery" ON instance_sample_gallery;
DROP POLICY IF EXISTS "Users can insert into their own instance sample gallery" ON instance_sample_gallery;
DROP POLICY IF EXISTS "Users can update their own instance sample gallery" ON instance_sample_gallery;
DROP POLICY IF EXISTS "Users can delete their own instance sample gallery" ON instance_sample_gallery;

-- Create proper RLS policies
CREATE POLICY "Users can view their own instance sample gallery" ON instance_sample_gallery
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM instances i
            JOIN user_accounts ua ON i.account_id = ua.account_id
            WHERE i.id = instance_sample_gallery.instance_id
            AND ua.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert into their own instance sample gallery" ON instance_sample_gallery
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM instances i
            JOIN user_accounts ua ON i.account_id = ua.account_id
            WHERE i.id = instance_sample_gallery.instance_id
            AND ua.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update their own instance sample gallery" ON instance_sample_gallery
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM instances i
            JOIN user_accounts ua ON i.account_id = ua.account_id
            WHERE i.id = instance_sample_gallery.instance_id
            AND ua.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete their own instance sample gallery" ON instance_sample_gallery
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM instances i
            JOIN user_accounts ua ON i.account_id = ua.account_id
            WHERE i.id = instance_sample_gallery.instance_id
            AND ua.user_id = auth.uid()
        )
    ); 