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
  rear_label  text default ''
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

-- Optional moderation later: add a `boolean approved default false` column and
-- change the read policy to `using (approved)` so only vetted devices show.
