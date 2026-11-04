-- Canvas AR – Supabase setup. Paste into Supabase → SQL Editor → Run (safe to re-run).
-- Phones (anon key) can only: upload their scan image, create a pending scan row,
-- and read the status of a scan whose id they know. Everything else needs a
-- signed-in user whose email is listed in public.admins (see the last line).

create extension if not exists pgcrypto;

-- Who counts as an admin. Being signed in is not enough on its own, so open sign-ups can't grant access.
create table if not exists public.admins (email text primary key);
alter table public.admins enable row level security; -- no policies: only editable from the SQL editor

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.admins a where lower(a.email) = lower(auth.jwt() ->> 'email')); $$;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.scans (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  session_id  text not null,
  name        text,
  image_path  text not null,
  width       integer,
  height      integer,
  scene       jsonb,
  status      text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  claimed_by  text,
  claimed_at  timestamptz,
  result_path text,
  error       text
);
create index if not exists scans_status_created on public.scans (status, created_at);

alter table public.scans enable row level security;

drop policy if exists "phones create pending scans" on public.scans;
create policy "phones create pending scans" on public.scans
  for insert to anon
  with check (status = 'pending' and result_path is null and claimed_by is null and image_path like 'scans/%');

drop policy if exists "admins manage scans" on public.scans;
create policy "admins manage scans" on public.scans
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- A phone reads only the scan it created (by its unguessable id).
create or replace function public.get_scan(scan_id uuid)
returns table (id uuid, status text, result_path text, error text, updated_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select s.id, s.status, s.result_path, s.error, s.updated_at from public.scans s where s.id = scan_id;
$$;
revoke all on function public.get_scan(uuid) from public;
grant execute on function public.get_scan(uuid) to anon, authenticated;

-- Atomically hand the oldest waiting scan to one admin worker (several dashboards can run at once).
-- Scans stuck in 'processing' for 10 minutes (closed tab) are handed out again.
create or replace function public.claim_scan(worker text)
returns setof public.scans
language sql volatile security invoker set search_path = public
as $$
  update public.scans s
     set status = 'processing', claimed_by = worker, claimed_at = now(), updated_at = now(), error = null
   where s.id = (
     select q.id from public.scans q
      where q.status = 'pending' or (q.status = 'processing' and q.claimed_at < now() - interval '10 minutes')
      order by q.created_at
      limit 1
      for update skip locked)
  returning s.*;
$$;
revoke all on function public.claim_scan(text) from public;
grant execute on function public.claim_scan(text) to authenticated;

-- Storage: one public bucket; phones may only add files under scans/, admins manage everything.
insert into storage.buckets (id, name, public, file_size_limit)
values ('canvas-ar', 'canvas-ar', true, 52428800)
on conflict (id) do update set public = true;

drop policy if exists "phones upload scans" on storage.objects;
create policy "phones upload scans" on storage.objects
  for insert to anon
  with check (bucket_id = 'canvas-ar' and (storage.foldername(name))[1] = 'scans');

drop policy if exists "admins manage files" on storage.objects;
create policy "admins manage files" on storage.objects
  for all to authenticated
  using (bucket_id = 'canvas-ar' and public.is_admin()) with check (bucket_id = 'canvas-ar' and public.is_admin());

-- >>> Replace with your admin's email (the user you create under Authentication → Users), then run:
-- insert into public.admins (email) values ('admin@example.com') on conflict do nothing;
