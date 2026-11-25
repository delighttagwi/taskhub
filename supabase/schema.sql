-- APP SURVEY Supabase schema
-- Run in Supabase SQL Editor. Do not expose the service-role key to browsers.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text,
  phone text not null unique,
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_email_unique on public.profiles(email) where email is not null;

create table if not exists public.wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  download_url text check (download_url like 'https://%' or download_url is null),
  task_type text not null default 'app' check (task_type in ('app', 'survey')),
  image_url text,
  instructions text,
  survey_questions jsonb not null default '[]'::jsonb check (jsonb_typeof(survey_questions) = 'array'),
  reward numeric(12,2) not null check (reward > 0),
  min_duration_minutes integer not null default 10 check (min_duration_minutes >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  task_id uuid not null references public.tasks(id),
  screenshot_path text,
  details text,
  duration_minutes integer check (duration_minutes is null or duration_minutes >= 10),
  reward_amount numeric(12,2) not null check (reward_amount > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_reason text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists submissions_one_live_attempt
  on public.submissions(user_id, task_id) where status in ('pending', 'approved');

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('task_reward', 'withdrawal_hold', 'withdrawal_refund', 'adjustment')),
  amount numeric(12,2) not null check (amount <> 0),
  description text not null,
  submission_id uuid unique references public.submissions(id),
  withdrawal_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  points_amount numeric(12,2) not null default 0 check (points_amount >= 0),
  points_per_usdt numeric(12,6) not null default 0 check (points_per_usdt >= 0),
  payout_details text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_reason text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  ledger_transaction_id uuid references public.transactions(id),
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_withdrawal_id_fkey') then
    alter table public.transactions add constraint transactions_withdrawal_id_fkey
      foreign key (withdrawal_id) references public.withdrawals(id);
  end if;
end $$;

create table if not exists public.chat_permissions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'locked' check (status in ('locked', 'unlocked', 'disabled')),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text check (char_length(body) between 1 and 2000),
  image_url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Client/platform funding is recorded before task rewards are approved.
create table if not exists public.funding_ledger (
  id uuid primary key default gen_random_uuid(),
  amount numeric(12,2) not null check (amount > 0),
  note text not null,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create or replace function public.is_app_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.profiles where id = p_user_id and role = 'admin' and status = 'active');
$$;

create or replace function public.handle_new_app_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.profiles(id, full_name, email, phone)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), new.email, new.phone),
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'phone', ''), new.phone)
  )
  on conflict (id) do update set full_name = excluded.full_name, email = excluded.email, phone = excluded.phone;
  insert into public.wallets(user_id) values (new.id) on conflict do nothing;
  insert into public.chat_permissions(user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_app_survey on auth.users;
create trigger on_auth_user_created_app_survey after insert on auth.users
for each row execute procedure public.handle_new_app_user();

create or replace view public.wallet_balances with (security_invoker = true) as
  select w.user_id, coalesce(sum(t.amount), 0)::numeric(12,2) as balance
  from public.wallets w left join public.transactions t on t.user_id = w.user_id
  group by w.user_id;

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
  if p_amount <= 0 or length(trim(p_payout_details)) < 5 then raise exception 'Enter a valid amount and payout details.'; end if;
  select coalesce((select (value #>> '{}')::numeric from public.settings where key = 'points_per_usdt'), 0) into v_points_per_usdt;
  if v_points_per_usdt <= 0 then raise exception 'Cash-out conversion rate is not configured.'; end if;
  v_points_to_hold := round(p_amount * v_points_per_usdt, 2);
  perform 1 from public.wallets where user_id = p_user_id for update;
  select coalesce(sum(amount), 0) into v_balance from public.transactions where user_id = p_user_id;
  select coalesce((value #>> '{}')::numeric, 200) into v_minimum from public.settings where key = 'minimum_withdrawal';
  if p_amount < v_minimum then raise exception 'Minimum withdrawal is USDT %.', v_minimum; end if;
  if v_points_to_hold > v_balance then raise exception 'Insufficient points balance. Required: % points.', v_points_to_hold; end if;
  insert into public.withdrawals(user_id, amount, points_amount, points_per_usdt, payout_details)
    values (p_user_id, p_amount, v_points_to_hold, v_points_per_usdt, trim(p_payout_details)) returning id into v_withdrawal_id;
  insert into public.transactions(user_id, kind, amount, description, withdrawal_id)
    values (p_user_id, 'withdrawal_hold', -v_points_to_hold, 'Withdrawal request pending', v_withdrawal_id)
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
    if v_reward <= 0 then raise exception 'Reward amount must be positive.'; end if;
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
      values (v_submission.user_id, 'task_reward', v_reward, 'Approved app testing task', p_submission_id);
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
      values (v_withdrawal.user_id, 'withdrawal_refund', v_withdrawal.points_amount, 'Withdrawal request rejected; points returned', p_withdrawal_id);
  end if;
end;
$$;

create or replace function public.record_platform_funding(p_admin_id uuid, p_amount numeric, p_note text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not public.is_app_admin(p_admin_id) then raise exception 'Administrator access required.'; end if;
  if p_amount <= 0 or length(trim(p_note)) < 3 then raise exception 'Enter a positive amount and funding reference.'; end if;
  insert into public.funding_ledger(amount, note, recorded_by) values (p_amount, trim(p_note), p_admin_id) returning id into v_id;
  return v_id;
end;
$$;

insert into public.settings(key, value) values
  ('currency', '"USDT"'::jsonb),
  ('reward_per_task', '50'::jsonb),
  ('daily_task_limit', '5'::jsonb),
  ('minimum_withdrawal', '200'::jsonb),
  ('points_per_usdt', '0'::jsonb)
on conflict (key) do nothing;

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.tasks enable row level security;
alter table public.submissions enable row level security;
alter table public.transactions enable row level security;
alter table public.withdrawals enable row level security;
alter table public.chat_permissions enable row level security;
alter table public.messages enable row level security;
alter table public.settings enable row level security;
alter table public.funding_ledger enable row level security;

create policy "Profiles visible to owner and admins" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_app_admin(auth.uid()));
create policy "Active tasks visible to signed-in users" on public.tasks for select to authenticated
  using (is_active or public.is_app_admin(auth.uid()));
create policy "Submissions visible to owner and admins" on public.submissions for select to authenticated
  using (user_id = auth.uid() or public.is_app_admin(auth.uid()));
create policy "Wallets visible to owner and admins" on public.wallets for select to authenticated
  using (user_id = auth.uid() or public.is_app_admin(auth.uid()));
create policy "Transactions visible to owner and admins" on public.transactions for select to authenticated
  using (user_id = auth.uid() or public.is_app_admin(auth.uid()));
create policy "Withdrawals visible to owner and admins" on public.withdrawals for select to authenticated
  using (user_id = auth.uid() or public.is_app_admin(auth.uid()));
create policy "Chat permissions visible to owner and admins" on public.chat_permissions for select to authenticated
  using (user_id = auth.uid() or public.is_app_admin(auth.uid()));
create policy "Chat messages visible to participant and admins" on public.messages for select to authenticated
  using (user_id = auth.uid() or public.is_app_admin(auth.uid()));
create policy "Settings visible to admins" on public.settings for select to authenticated
  using (public.is_app_admin(auth.uid()));
create policy "Funding visible to admins" on public.funding_ledger for select to authenticated
  using (public.is_app_admin(auth.uid()));

-- No client-side writes are granted by policies. The Next.js server validates each
-- user/admin request and uses the private service-role key for database mutations.
revoke all on public.profiles, public.wallets, public.tasks, public.submissions, public.transactions,
  public.withdrawals, public.chat_permissions, public.messages, public.settings, public.funding_ledger from anon, authenticated;
grant all privileges on all tables in schema public to service_role;
grant select on public.profiles, public.wallets, public.tasks, public.submissions, public.transactions,
  public.withdrawals, public.chat_permissions, public.messages, public.settings, public.funding_ledger to authenticated;
grant select on public.wallet_balances to authenticated;
revoke all on function public.request_withdrawal(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.review_submission(uuid, uuid, boolean, text, numeric) from public, anon, authenticated;
revoke all on function public.review_withdrawal(uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.record_platform_funding(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.request_withwithdrawal(uuid, numeric, text) to service_role;
grant execute on function public.review_submission(uuid, uuid, boolean, text, numeric) to service_role;
grant execute on function public.review_withdrawal(uuid, uuid, boolean, text) to service_role;
grant execute on function public.record_platform_funding(uuid, numeric, text) to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('proofs', 'proofs', false, 8388608, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 8388608,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('task-images', 'task-images', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', true, 8388608, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 8388608,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];
create policy "Users upload own proof images" on storage.objects for insert to authenticated
  with check (bucket_id = 'proofs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Users and admins read proof images" on storage.objects for select to authenticated
  using (bucket_id = 'proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_app_admin(auth.uid())));

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
