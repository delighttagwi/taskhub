-- Allow chat messages to contain an optional image.

alter table public.messages add column if not exists image_url text;
alter table public.messages alter column body drop not null;

alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check
  check ((body is null and image_url is not null) or (body is not null and char_length(body) between 1 and 2000));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', true, 8388608, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 8388608,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];
