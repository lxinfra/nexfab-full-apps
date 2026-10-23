-- =============================================================================
-- Storage bucket + Row Level Security
--
-- Run after 0001_schema.sql.
--
-- IMPORTANT — read before applying:
-- This application currently has NO authentication. Every visitor is the same
-- anonymous user. Two policy sets are given below; pick the one that matches
-- how you will run it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Storage bucket for uploads (logos, signatures, invoice attachments)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bill-files',
  'bill-files',
  false,                                   -- private: served through signed URLs
  10485760,                                -- 10 MB per file
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
  ]
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- =============================================================================
-- OPTION A — single-user / self-hosted, no authentication  (matches the app today)
--
-- The app talks to Supabase from the server only, using the SERVICE ROLE key,
-- which bypasses RLS entirely. RLS is still enabled so that the anon key — the
-- one that would be exposed in a browser — can read and write nothing.
-- This is the safe default while the app has no login.
-- =============================================================================
alter table public.companies         enable row level security;
alter table public.customers         enable row level security;
alter table public.products          enable row level security;
alter table public.invoices          enable row level security;
alter table public.invoice_items     enable row level security;
alter table public.payments          enable row level security;
alter table public.invoice_counters  enable row level security;
alter table public.invoice_revisions enable row level security;
alter table public.uploads           enable row level security;

-- No policies are created for OPTION A. With RLS on and no policy, every role
-- except service_role is denied, which is exactly what we want: the anon key is
-- useless on its own and all access goes through the server.

revoke all on storage.objects from anon;

-- =============================================================================
-- OPTION B — multi-user with Supabase Auth
--
-- Apply this INSTEAD of Option A once you add login. It assumes an owner_id
-- column linking each company to an auth user, and scopes everything through it.
-- Uncomment to use.
-- =============================================================================
--
-- alter table public.companies add column if not exists owner_id uuid
--   references auth.users(id) on delete cascade;
--
-- create policy "own companies" on public.companies
--   for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
--
-- create policy "own customers" on public.customers
--   for all using (exists (
--     select 1 from public.companies c
--     where c.id = customers.company_id and c.owner_id = auth.uid()))
--   with check (exists (
--     select 1 from public.companies c
--     where c.id = customers.company_id and c.owner_id = auth.uid()));
--
-- create policy "own products" on public.products
--   for all using (exists (
--     select 1 from public.companies c
--     where c.id = products.company_id and c.owner_id = auth.uid()))
--   with check (exists (
--     select 1 from public.companies c
--     where c.id = products.company_id and c.owner_id = auth.uid()));
--
-- create policy "own invoices" on public.invoices
--   for all using (exists (
--     select 1 from public.companies c
--     where c.id = invoices.company_id and c.owner_id = auth.uid()))
--   with check (exists (
--     select 1 from public.companies c
--     where c.id = invoices.company_id and c.owner_id = auth.uid()));
--
-- create policy "own invoice items" on public.invoice_items
--   for all using (exists (
--     select 1 from public.invoices i join public.companies c on c.id = i.company_id
--     where i.id = invoice_items.invoice_id and c.owner_id = auth.uid()));
--
-- create policy "own payments" on public.payments
--   for all using (exists (
--     select 1 from public.invoices i join public.companies c on c.id = i.company_id
--     where i.id = payments.invoice_id and c.owner_id = auth.uid()));
--
-- create policy "own revisions" on public.invoice_revisions
--   for all using (exists (
--     select 1 from public.invoices i join public.companies c on c.id = i.company_id
--     where i.id = invoice_revisions.invoice_id and c.owner_id = auth.uid()));
--
-- create policy "own counters" on public.invoice_counters
--   for all using (exists (
--     select 1 from public.companies c
--     where c.id = invoice_counters.company_id and c.owner_id = auth.uid()));
--
-- create policy "own uploads" on public.uploads
--   for all using (exists (
--     select 1 from public.companies c
--     where c.id = uploads.company_id and c.owner_id = auth.uid()));
--
-- -- Storage: files live under <company_id>/..., so the first path segment
-- -- decides who may touch them.
-- create policy "read own files" on storage.objects
--   for select using (
--     bucket_id = 'bill-files' and exists (
--       select 1 from public.companies c
--       where c.id::text = (storage.foldername(name))[1] and c.owner_id = auth.uid()));
--
-- create policy "write own files" on storage.objects
--   for insert with check (
--     bucket_id = 'bill-files' and exists (
--       select 1 from public.companies c
--       where c.id::text = (storage.foldername(name))[1] and c.owner_id = auth.uid()));
--
-- create policy "delete own files" on storage.objects
--   for delete using (
--     bucket_id = 'bill-files' and exists (
--       select 1 from public.companies c
--       where c.id::text = (storage.foldername(name))[1] and c.owner_id = auth.uid()));
