-- Allow authenticated users to upload/delete instance logos in Supabase Storage.
--
-- The designer uploads logos to the public `images` bucket at:
--   logos/<instanceId>/<timestamp>-<originalFilename>
--
-- RLS on `storage.objects` must allow INSERT/DELETE for those paths,
-- scoped to instances the current user can access via `user_accounts`.

-- INSERT policy (upload)
DROP POLICY IF EXISTS "Authenticated users can upload instance logos" ON storage.objects;
CREATE POLICY "Authenticated users can upload instance logos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'images'
  AND split_part(name, '/', 1) = 'logos'
  AND auth.uid() = owner
  AND EXISTS (
    SELECT 1
    FROM public.instances i
    JOIN public.user_accounts ua ON ua.account_id = i.account_id
    WHERE ua.user_id = auth.uid()
      AND i.id::text = split_part(name, '/', 2)
  )
);

-- DELETE policy (cleanup)
DROP POLICY IF EXISTS "Authenticated users can delete instance logos" ON storage.objects;
CREATE POLICY "Authenticated users can delete instance logos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'images'
  AND split_part(name, '/', 1) = 'logos'
  AND auth.uid() = owner
  AND EXISTS (
    SELECT 1
    FROM public.instances i
    JOIN public.user_accounts ua ON ua.account_id = i.account_id
    WHERE ua.user_id = auth.uid()
      AND i.id::text = split_part(name, '/', 2)
  )
);

