-- Drop the broken policy that uses non-existent JWT claim
DROP POLICY IF EXISTS "Allow select for users in their instance" ON public.instance_sample_gallery;

-- Create the correct policy that checks user access through user_accounts
CREATE POLICY "Allow select for users in their instance"
ON public.instance_sample_gallery
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM instances i
    JOIN user_accounts ua ON i.account_id = ua.account_id
    WHERE i.id = instance_sample_gallery.instance_id
    AND ua.user_id = auth.uid()
  )
);

-- Add policies for other operations
CREATE POLICY "Allow insert for users in their instance"
ON public.instance_sample_gallery
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM instances i
    JOIN user_accounts ua ON i.account_id = ua.account_id
    WHERE i.id = instance_sample_gallery.instance_id
    AND ua.user_id = auth.uid()
  )
);

CREATE POLICY "Allow update for users in their instance"
ON public.instance_sample_gallery
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM instances i
    JOIN user_accounts ua ON i.account_id = ua.account_id
    WHERE i.id = instance_sample_gallery.instance_id
    AND ua.user_id = auth.uid()
  )
);

CREATE POLICY "Allow delete for users in their instance"
ON public.instance_sample_gallery
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM instances i
    JOIN user_accounts ua ON i.account_id = ua.account_id
    WHERE i.id = instance_sample_gallery.instance_id
    AND ua.user_id = auth.uid()
  )
); 