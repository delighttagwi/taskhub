-- Survey-only tasks can validly require zero testing minutes.
alter table public.submissions
  drop constraint if exists submissions_duration_minutes_check;

alter table public.submissions
  add constraint submissions_duration_minutes_nonnegative
  check (duration_minutes is null or duration_minutes >= 0);

notify pgrst, 'reload schema';