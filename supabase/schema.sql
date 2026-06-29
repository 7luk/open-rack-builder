-- Open Rack Builder — community device registry
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.
-- Safe to re-run (drops are guarded). Devices are METADATA ONLY — no images.

create table if not exists public.devices (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text,
  name        text not null,
  brand       text default '',
  cat         text default 'Community',
  u           int  not null default 1   check (u between 1 and 12),
  color       text default '#2a2a2e',
  depth       int  default 250          check (depth between 20 and 2000),
  rear_label  text default '',
  dev         boolean not null default false  -- set server-side (see trigger)
);

-- Row-Level Security: the server enforces who can read/write, so it is safe
-- to talk to this table directly from the browser with the public anon key.
alter table public.devices enable row level security;

-- Anyone (including signed-out guests) may READ the whole library.
drop policy if exists "devices_public_read" on public.devices;
create policy "devices_public_read"
  on public.devices for select
  using (true);

-- Only signed-in users may INSERT, and only rows owned by themselves.
drop policy if exists "devices_insert_own" on public.devices;
create policy "devices_insert_own"
  on public.devices for insert
  to authenticated
  with check (user_id = auth.uid());

-- Authors may UPDATE their own submissions.
drop policy if exists "devices_update_own" on public.devices;
create policy "devices_update_own"
  on public.devices for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Authors may DELETE their own submissions.
drop policy if exists "devices_delete_own" on public.devices;
create policy "devices_delete_own"
  on public.devices for delete
  to authenticated
  using (user_id = auth.uid());

-- "DEV" badge: mark devices published by the project developer. The flag is
-- set SERVER-SIDE from the signed-in user's verified email, so it can't be
-- spoofed by a crafted API call, and no email is ever exposed to clients
-- (the public read returns only this boolean). Change the address below if a
-- different account should own the badge.
alter table public.devices add column if not exists dev boolean not null default false;

create or replace function public.set_device_dev_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.dev := coalesce(auth.jwt() ->> 'email', '') = 'thegamingcompani@gmail.com';
  return new;
end;
$$;

drop trigger if exists devices_set_dev_flag on public.devices;
create trigger devices_set_dev_flag
  before insert on public.devices
  for each row execute function public.set_device_dev_flag();

-- No duplicates / no copying someone else's work: a device is identified by
-- its normalised brand + name (trimmed, internal whitespace collapsed,
-- lowercased). This UNIQUE index makes it impossible to publish the same gear
-- twice — including re-publishing a device another user already submitted.
-- The expression MUST match normSlug() in js/community.js.
-- (If this errors because duplicates already exist, remove them first.)
create unique index if not exists devices_unique_identity on public.devices (
  lower(btrim(regexp_replace(btrim(coalesce(brand, '')) || ' ' || btrim(coalesce(name, '')), '\s+', ' ', 'g')))
);

-- Optional moderation later: add a `boolean approved default false` column and
-- change the read policy to `using (approved)` so only vetted devices show.
