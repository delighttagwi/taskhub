-- Store task rewards in points; convert to USDT only at cash-out.
-- Funding remains required for actual USDT withdrawal approval, never for registration.

alter table public.withdrawals
  add column if not exists points_amount numeric(12,2) not null default 0 check (points_amount >= 0),
  add column if not exists points_per_usdt numeric(12,6) not null default 0 check (points_per_usdt >= 0);

insert into public.settings(key, value) values ('points_per_usdt', '0'::jsonb)
on conflict (key) do nothing;

create or replace function public.request_withdrawal(p_user_id uuid, p_amount numeric, p_payout_details text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_balance numeric(12,2);
  v_minimum numeric(12,2);
  v_points_per_usdt numeric(12,6);
  v_points_to_hold numeric(12,2);
  v_withdrawal_id uuid;
  v_transaction_id uuid;
begin
  if not exists (select 1 from public.profiles where id = p_user_id and status = 'active' and role = 'user') then
    raise exception 'Active user account required.';
  end if;
  if p_amount <= 0 or length(trim(p_payout_details)) < 5 then raise exception 'Enter a valid USDT amount and payout details.'; end if;
  select coalesce((select (value #>> '{}')::numeric from public.settings where key = 'points_per_usdt'), 0) into v_points_per_usdt;
  if v_points_per_usdt <= 0 then raise exception 'Admin has not configured the points-to-USDT cash-out rate.'; end if;
  v_points_to_hold := round(p_amount * v_points_per_usdt, 2);
  perform 1 from public.wallets where user_id = p_user_id for update;
  select coalesce(sum(amount), 0) into v_balance from public.transactions where user_id = p_user_id;
  select coalesce((value #>> '{}')::numeric, 200) into v_minimum from public.settings where key = 'minimum_withdrawal';
  if p_amount < v_minimum then raise exception 'Minimum withdrawal is USDT %.', v_minimum; end if;
  if v_points_to_hold > v_balance then raise exception 'Insufficient points balance. Required: % points.', v_points_to_hold; end if;
  insert into public.withdrawals(user_id, amount, points_amount, points_per_usdt, payout_details)
    values (p_user_id, p_amount, v_points_to_hold, v_points_per_usdt, trim(p_payout_details)) returning id into v_withdrawal_id;
  insert into public.transactions(user_id, kind, amount, description, withdrawal_id)
    values (p_user_id, 'withdrawal_hold', -v_points_to_hold, 'Points held for USDT withdrawal', v_withdrawal_id)
    returning id into v_transaction_id;
  update public.withdrawals set ledger_transaction_id = v_transaction_id where id = v_withdrawal_id;
  return v_withdrawal_id;
end;
$$;

create or replace function public.review_submission(p_admin_id uuid, p_submission_id uuid, p_approve boolean, p_reason text default '', p_reward_amount numeric default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_submission public.submissions%rowtype;
  v_daily_limit integer;
  v_reward numeric(12,2);
begin
  if not public.is_app_admin(p_admin_id) then raise exception 'Administrator access required.'; end if;
  select * into v_submission from public.submissions where id = p_submission_id for update;
  if not found or v_submission.status <> 'pending' then raise exception 'Submission is no longer pending.'; end if;
  if p_approve then
    v_reward := coalesce(p_reward_amount, v_submission.reward_amount);
    if v_reward <= 0 then raise exception 'Reward points must be positive.'; end if;
    perform 1 from public.wallets where user_id = v_submission.user_id for update;
    if not exists (select 1 from public.profiles where id = v_submission.user_id and status = 'active' and role = 'user') then
      raise exception 'Active user account required.';
    end if;
    select coalesce((select (value #>> '{}')::integer from public.settings where key = 'daily_task_limit'), 5) into v_daily_limit;
    if (select count(*) from public.submissions where user_id = v_submission.user_id and status = 'approved' and decided_at >= date_trunc('day', now())) >= v_daily_limit then
      raise exception 'This user has reached the daily task limit.';
    end if;
    update public.submissions set status = 'approved', reward_amount = v_reward, decided_by = p_admin_id, decided_at = now(), decision_reason = null where id = p_submission_id;
    insert into public.transactions(user_id, kind, amount, description, submission_id)
      values (v_submission.user_id, 'task_reward', v_reward, 'Approved app testing task points', p_submission_id);
  else
    if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Add a clear reason for rejecting this submission.'; end if;
    update public.submissions set status = 'rejected', decided_by = p_admin_id, decided_at = now(), decision_reason = trim(p_reason) where id = p_submission_id;
  end if;
end;
$$;

create or replace function public.review_withdrawal(p_admin_id uuid, p_withdrawal_id uuid, p_approve boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_withdrawal public.withdrawals%rowtype;
  v_funded numeric(12,2);
  v_paid numeric(12,2);
begin
  if not public.is_app_admin(p_admin_id) then raise exception 'Administrator access required.'; end if;
  select * into v_withdrawal from public.withdrawals where id = p_withdrawal_id for update;
  if not found or v_withdrawal.status <> 'pending' then raise exception 'Withdrawal is no longer pending.'; end if;
  if p_approve then
    perform 1 from public.funding_ledger order by created_at limit 1 for update;
    select coalesce(sum(amount), 0) into v_funded from public.funding_ledger;
    select coalesce(sum(amount), 0) into v_paid from public.withdrawals where status = 'approved';
    if v_withdrawal.amount > v_funded - v_paid then raise exception 'Not enough recorded platform funding for this USDT payout.'; end if;
    update public.withdrawals set status = 'approved', decided_by = p_admin_id, decided_at = now(), decision_reason = null where id = p_withdrawal_id;
  else
    if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Add a clear reason for rejecting this withdrawal.'; end if;
    update public.withdrawals set status = 'rejected', decided_by = p_admin_id, decided_at = now(), decision_reason = trim(p_reason) where id = p_withdrawal_id;
    insert into public.transactions(user_id, kind, amount, description, withdrawal_id)
      values (v_withdrawal.user_id, 'withdrawal_refund', v_withdrawal.points_amount, 'Rejected USDT payout; points returned', p_withdrawal_id);
  end if;
end;
$$;

revoke all on function public.request_withdrawal(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.review_submission(uuid, uuid, boolean, text, numeric) from public, anon, authenticated;
revoke all on function public.review_withdrawal(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.request_withdrawal(uuid, numeric, text) to service_role;
grant execute on function public.review_submission(uuid, uuid, boolean, text, numeric) to service_role;
grant execute on function public.review_withdrawal(uuid, uuid, boolean, text) to service_role;
notify pgrst, 'reload schema';
