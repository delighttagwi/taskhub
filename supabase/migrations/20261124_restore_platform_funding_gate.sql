-- Restore the platform-funded cap on admin-approved virtual USDT rewards.
-- This tracks client/platform funding only; do not require user deposits to register or earn.

create or replace function public.review_submission(
  p_admin_id uuid,
  p_submission_id uuid,
  p_approve boolean,
  p_reason text default '',
  p_reward_amount numeric default null
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_submission public.submissions%rowtype;
  v_daily_limit integer;
  v_funded numeric(12,2);
  v_paid numeric(12,2);
  v_reward numeric(12,2);
begin
  if not public.is_app_admin(p_admin_id) then raise exception 'Administrator access required.'; end if;
  select * into v_submission from public.submissions where id = p_submission_id for update;
  if not found or v_submission.status <> 'pending' then raise exception 'Submission is no longer pending.'; end if;
  if p_approve then
    v_reward := coalesce(p_reward_amount, v_submission.reward_amount);
    if v_reward <= 0 then raise exception 'Reward amount must be positive.'; end if;
    perform 1 from public.wallets where user_id = v_submission.user_id for update;
    if not exists (select 1 from public.profiles where id = v_submission.user_id and status = 'active' and role = 'user') then
      raise exception 'Active user account required.';
    end if;
    select coalesce((select (value #>> '{}')::integer from public.settings where key = 'daily_task_limit'), 5) into v_daily_limit;
    if (select count(*) from public.submissions where user_id = v_submission.user_id and status = 'approved' and decided_at >= date_trunc('day', now())) >= v_daily_limit then
      raise exception 'This user has reached the daily task limit.';
    end if;
    perform 1 from public.funding_ledger order by created_at limit 1 for update;
    select coalesce(sum(amount), 0) into v_funded from public.funding_ledger;
    select coalesce(sum(amount), 0) into v_paid from public.transactions where kind = 'task_reward';
    if v_reward > v_funded - v_paid then raise exception 'Not enough recorded platform funding for this reward.'; end if;
    update public.submissions set status = 'approved', reward_amount = v_reward, decided_by = p_admin_id, decided_at = now(), decision_reason = null where id = p_submission_id;
    insert into public.transactions(user_id, kind, amount, description, submission_id)
      values (v_submission.user_id, 'task_reward', v_reward, 'Approved app testing task', p_submission_id);
  else
    if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Add a clear reason for rejecting this submission.'; end if;
    update public.submissions set status = 'rejected', decided_by = p_admin_id, decided_at = now(), decision_reason = trim(p_reason) where id = p_submission_id;
  end if;
end;
$$;

revoke all on function public.review_submission(uuid, uuid, boolean, text, numeric) from public, anon, authenticated;
grant execute on function public.review_submission(uuid, uuid, boolean, text, numeric) to service_role;
notify pgrst, 'reload schema';
