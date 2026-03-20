-- Fix storage logo upload RLS:
-- Some Storage inserts may not populate `owner` as expected for the policy check timing,
-- which can cause "new row violates row-level security policy".
-- We keep the policy tightly scoped to:
--   bucket = images
--   prefix = logos/<instanceId>/
--   instanceId must belong to an account the current user is a member of
-- and we do NOT require owner matching.

DROP POLICY IF EXISTS "Authenticated users can upload instance logos" ON storage.objects;
CREATE POLICY "Authenticated users can upload instance logos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'images'
  AND split_part(name, '/', 1) = 'logos'
  AND EXISTS (
    SELECT 1
    FROM public.instances i
    JOIN public.user_accounts ua ON ua.account_id = i.account_id
    WHERE ua.user_id = auth.uid()
      AND i.id::text = split_part(name, '/', 2)
  )
);

DROP POLICY IF EXISTS "Authenticated users can delete instance logos" ON storage.objects;
CREATE POLICY "Authenticated users can delete instance logos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'images'
  AND split_part(name, '/', 1) = 'logos'
  AND EXISTS (
    SELECT 1
    FROM public.instances i
    JOIN public.user_accounts ua ON ua.account_id = i.account_id
    WHERE ua.user_id = auth.uid()
      AND i.id::text = split_part(name, '/', 2)
  )
);

