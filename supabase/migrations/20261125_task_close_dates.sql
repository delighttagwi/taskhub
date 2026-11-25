-- Optional close date for surveys/tasks.
-- When closes_at passes, the task is hidden and submissions are rejected.

alter table public.tasks
  add column if not exists closes_at timestamptz;

create or replace function public.hide_expired_tasks()
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.tasks
  set is_active = false
  where closes_at is not null
    and closes_at <= now()
    and is_active = true;
$$;

revoke all on function public.hide_expired_tasks() from public, anon, authenticated;
grant execute on function public.hide_expired_tasks() to service_role;

notify pgrst, 'reload schema';
