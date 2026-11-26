-- Allow administrators to disable the withdrawal minimum by setting minimum_withdrawal to 0.
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
  if p_amount <= 0 or length(trim(p_payout_details)) < 5 then
    raise exception 'Enter a valid amount and payout details.';
  end if;
  select coalesce((select (value #>> '{}')::numeric from public.settings where key = 'points_per_usdt'), 0)
    into v_points_per_usdt;
  if v_points_per_usdt <= 0 then
    raise exception 'Cash-out conversion rate is not configured.';
  end if;
  v_points_to_hold := round(p_amount * v_points_per_usdt, 2);
  perform 1 from public.wallets where user_id = p_user_id for update;
  select coalesce(sum(amount), 0) into v_balance
    from public.transactions where user_id = p_user_id;
  select coalesce((value #>> '{}')::numeric, 200) into v_minimum
    from public.settings where key = 'minimum_withdrawal';
  if v_minimum > 0 and p_amount < v_minimum then
    raise exception 'Minimum withdrawal is USDT %.', v_minimum;
  end if;
  if v_points_to_hold > v_balance then
    raise exception 'Insufficient points balance. Required: % points.', v_points_to_hold;
  end if;
  insert into public.withdrawals(user_id, amount, points_amount, points_per_usdt, payout_details)
    values (p_user_id, p_amount, v_points_to_hold, v_points_per_usdt, trim(p_payout_details))
    returning id into v_withdrawal_id;
  insert into public.transactions(user_id, kind, amount, description, withdrawal_id)
    values (p_user_id, 'withdrawal_hold', -v_points_to_hold, 'Withdrawal request pending', v_withdrawal_id)
    returning id into v_transaction_id;
  update public.withdrawals set ledger_transaction_id = v_transaction_id where id = v_withdrawal_id;
  return v_withdrawal_id;
end;
$$;

revoke all on function public.request_withdrawal(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.request_withdrawal(uuid, numeric, text) to service_role;
notify pgrst, 'reload schema';
