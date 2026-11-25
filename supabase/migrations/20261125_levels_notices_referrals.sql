-- Five-level member system, admin notices, and referral rewards.

alter table public.profiles
  add column if not exists level integer not null default 1 check (level between 1 and 5),
  add column if not exists referral_code text,
  add column if not exists referred_by uuid references public.profiles(id);

alter table public.tasks
  add column if not exists level integer not null default 1 check (level between 1 and 5);

create unique index if not exists profiles_referral_code_unique
  on public.profiles(referral_code) where referral_code is not null;

create table if not exists public.app_notices (
  id uuid primary key default gen_random_uuid(),
  message text,
  image_url text,
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint app_notice_content check (char_length(coalesce(message, '')) > 0 or image_url is not null)
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id),
  referred_id uuid not null unique references public.profiles(id),
  reward_amount numeric(12,2) not null default 0,
  status text not null default 'pending' check (status in ('pending','rewarded')),
  created_at timestamptz not null default now()
);

insert into public.settings(key, value) values
  ('referral_signup_reward', '5'::jsonb),
  ('level_2_upgrade_reward', '0'::jsonb),
  ('level_3_upgrade_reward', '0'::jsonb),
  ('level_4_upgrade_reward', '0'::jsonb),
  ('level_5_upgrade_reward', '0'::jsonb)
on conflict (key) do nothing;

create or replace function public.make_referral_code(p_id uuid)
returns text language sql immutable security definer set search_path = public, pg_temp as $$
  select 'AS-' || upper(substr(replace(p_id::text, '-', ''), 1, 8));
$$;

update public.profiles
set referral_code = public.make_referral_code(id)
where referral_code is null or btrim(referral_code) = '';

alter table public.app_notices enable row level security;
alter table public.referrals enable row level security;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('notice-images', 'notice-images', true, 8388608, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 8388608,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

create or replace function public.apply_referral(p_user_id uuid, p_referral_code text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_referrer_id uuid;
  v_reward numeric(12,2);
begin
  if p_referral_code is null or btrim(p_referral_code) = '' then return; end if;
  select id into v_referrer_id from public.profiles
  where upper(referral_code) = upper(btrim(p_referral_code)) and role = 'user';
  if not found or v_referrer_id = p_user_id then return; end if;

  update public.profiles set referred_by = v_referrer_id where id = p_user_id;
  insert into public.referrals(referrer_id, referred_id, reward_amount, status)
  values (v_referrer_id, p_user_id, 0, 'pending')
  on conflict (referred_id) do nothing;

  select coalesce((value #>> '{}')::numeric, 5) into v_reward
  from public.settings where key = 'referral_signup_reward';
  if v_reward is null then v_reward := 5; end if;
  if v_reward > 0 then
    insert into public.transactions(user_id, kind, amount, description)
    values (v_referrer_id, 'adjustment', v_reward, 'Referral signup reward');
    update public.referrals set reward_amount = v_reward, status = 'rewarded'
    where referred_id = p_user_id;
  end if;
end;
$$;

create or replace function public.upgrade_user_level(p_admin_id uuid, p_user_id uuid, p_level integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old_level integer;
  v_upgrade_reward numeric(12,2);
  v_setting_key text;
begin
  if not public.is_app_admin(p_admin_id) then raise exception 'Administrator access required.'; end if;
  if p_level < 1 or p_level > 5 then raise exception 'Level must be between 1 and 5.'; end if;
  select level into v_old_level from public.profiles where id = p_user_id and role = 'user' for update;
  if not found then raise exception 'User account not found.'; end if;
  if p_level < v_old_level then raise exception 'Admin may only move users up levels.'; end if;
  if p_level = v_old_level then raise exception 'User is already at Level %.', p_level; end if;

  update public.profiles set level = p_level where id = p_user_id;

  v_setting_key := 'level_' || p_level || '_upgrade_reward';
  select coalesce((value #>> '{}')::numeric, 0) into v_upgrade_reward
  from public.settings where key = v_setting_key;

  if v_upgrade_reward > 0 then
    update public.referrals set reward_amount = reward_amount + v_upgrade_reward
    where referred_id = p_user_id;
    insert into public.transactions(user_id, kind, amount, description)
    select r.referrer_id, 'adjustment', v_upgrade_reward,
           'Referral Level ' || p_level || ' upgrade reward'
    from public.referrals r where r.referred_id = p_user_id;
  end if;
end;
$$;

create or replace function public.ensure_profile_referral_code()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.referral_code is null or btrim(new.referral_code) = '' then
    new.referral_code := public.make_referral_code(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists ensure_profile_referral_code on public.profiles;
create trigger ensure_profile_referral_code
before insert or update of referral_code on public.profiles
for each row execute procedure public.ensure_profile_referral_code();

revoke all on function public.make_referral_code(uuid) from public, anon, authenticated;
revoke all on function public.apply_referral(uuid, text) from public, anon, authenticated;
revoke all on function public.upgrade_user_level(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.apply_referral(uuid, text) to service_role;
grant execute on function public.upgrade_user_level(uuid, uuid, integer) to service_role;

notify pgrst, 'reload schema';
