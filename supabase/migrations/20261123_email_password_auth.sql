-- Run this once in Supabase SQL Editor after the original APP SURVEY schema.
-- Email is the Supabase login identity; phone remains a required contact field.

alter table public.profiles add column if not exists email text;

update public.profiles as profile
set email = auth_user.email
from auth.users as auth_user
where profile.id = auth_user.id and profile.email is null and auth_user.email is not null;

create unique index if not exists profiles_email_unique
  on public.profiles(email) where email is not null;

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
  on conflict (id) do update
    set full_name = excluded.full_name,
        email = excluded.email,
        phone = excluded.phone;
  insert into public.wallets(user_id) values (new.id) on conflict do nothing;
  insert into public.chat_permissions(user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
