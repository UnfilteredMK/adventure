-- Create compatibility wrapper for missing function used by API
-- Maps to existing get_session_submission_count(p_instance_id uuid, p_session_id text)
-- Returns true if submission count >= 1 (step 2 completed)

create or replace function public.has_session_completed_step2(
  p_instance_id uuid,
  p_session_id text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(public.get_session_submission_count(p_instance_id := p_instance_id, p_session_id := p_session_id), 0) >= 1;
$$;

comment on function public.has_session_completed_step2(uuid, text)
  is 'Compatibility wrapper: returns true if the session has at least one completed submission for the given instance.';


