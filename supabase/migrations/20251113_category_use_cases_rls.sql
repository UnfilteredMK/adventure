-- Enable RLS and add a read policy scoped to categories the user can access
ALTER TABLE public.category_use_cases ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to select mappings for categories that are globally active
-- or belong to an account the user is a member of (via user_accounts)
CREATE POLICY "select_category_use_cases_for_accessible_categories"
ON public.category_use_cases
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.categories c
    WHERE c.id = category_use_cases.category_id
      AND (
        c.account_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.user_accounts ua
          WHERE ua.account_id = c.account_id
            AND ua.user_id = auth.uid()
        )
      )
  )
);

-- No insert/update/delete policies → writes are denied by default


