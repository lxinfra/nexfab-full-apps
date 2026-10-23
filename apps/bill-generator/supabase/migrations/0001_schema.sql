-- =============================================================================
-- GST Bill Generator — Supabase / PostgreSQL schema
--
-- Run this in the Supabase SQL editor (or `supabase db push`) against your own
-- project. It mirrors prisma/schema.prisma, which is the source of truth for the
-- application; this file is the Postgres translation plus the server-side
-- invoice numbering function.
--
-- Money is stored as integer paise and quantities as integer thousandths, so
-- there is no floating point anywhere in the tax calculation.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- companies (the businesses you bill FROM)
-- ---------------------------------------------------------------------------
create table if not exists public.companies (
  id                uuid primary key default gen_random_uuid(),
  legal_name        text        not null,
  trade_name        text,
  initials          text,
  tagline           text,
  logo_path         text,
  address_line1     text        not null,
  address_line2     text,
  city              text        not null,
  state             text        not null,
  state_code        text        not null,
  pincode           text        not null,
  country           text        not null default 'India',
  gstin             text,
  pan               text,
  cin               text,
  phone             text,
  email             text,
  website           text,

  bank_name         text,
  bank_account_name text,
  bank_account_no   text,
  bank_ifsc         text,
  bank_branch       text,
  bank_account_type text,
  upi_id            text,

  invoice_prefix    text        not null default 'INV/',
  number_format     text        not null default '{BUYERWORD}/{MMM}/{YY}/{SEQ}',
  number_padding    int         not null default 4,
  number_start      int         not null default 1,
  include_fy_in_no  boolean     not null default true,
  invoice_subtitle  text,
  default_terms     text,
  signature_path    text,
  labels            jsonb,

  is_active         boolean     not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- customers (the businesses you bill TO), scoped to a company
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  name                 text not null,
  initials             text,
  gstin                text,
  phone                text,
  email                text,

  billing_line1        text not null,
  billing_line2        text,
  billing_city         text not null,
  billing_state        text not null,
  billing_state_code   text not null,
  billing_pincode      text not null,

  ship_same_as_billing boolean not null default true,
  shipping_name        text,
  shipping_line1       text,
  shipping_line2       text,
  shipping_city        text,
  shipping_state       text,
  shipping_state_code  text,
  shipping_pincode     text,

  notes                text,
  is_active            boolean     not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists customers_company_name_idx on public.customers (company_id, name);

-- ---------------------------------------------------------------------------
-- products / services
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  description text,
  hsn_sac     text,
  unit        text not null default 'PCS',
  rate_paise  bigint not null,
  gst_rate    int    not null,
  is_service  boolean not null default false,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists products_company_name_idx on public.products (company_id, name);

-- ---------------------------------------------------------------------------
-- invoice number counters — one row per company + document type + bucket
--
-- The bucket is what the sequence restarts on. With the default number format
-- ({BUYERWORD}/{MMM}/{YY}/{SEQ}) the bucket is "<year>-<month>|<customer-id>",
-- so each customer gets its own run of 0001.. within each calendar month.
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_counters (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  doc_type    text not null,
  bucket      text not null,
  last_number int  not null default 0,
  updated_at  timestamptz not null default now(),
  constraint invoice_counters_unique unique (company_id, doc_type, bucket)
);

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------
create table if not exists public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete restrict,
  customer_id         uuid not null references public.customers(id) on delete restrict,
  doc_type            text not null default 'TAX_INVOICE',

  number              text,          -- null while it is still a draft
  seq_bucket          text,          -- the counter bucket the sequence came from
  seq                 int,
  fy                  text not null,

  invoice_date        date        not null,
  due_date            date,
  place_of_supply     text        not null,
  place_of_supply_code text       not null,

  -- INTRA_STATE | INTRA_CITY | INTER_STATE
  -- INTRA_CITY is taxed like INTRA_STATE (CGST + SGST); only INTER_STATE is IGST.
  supply_type         text        not null,
  reverse_charge      boolean     not null default false,
  status              text        not null default 'DRAFT',

  agreement_no        text,
  work_order_date     date,
  rebate_label        text,
  rebate_bp           int         not null default 0,
  rebate_paise        bigint      not null default 0,

  company_snapshot    jsonb       not null,
  customer_snapshot   jsonb       not null,

  subtotal_paise      bigint      not null default 0,
  discount_paise      bigint      not null default 0,
  taxable_paise       bigint      not null default 0,
  cgst_paise          bigint      not null default 0,
  sgst_paise          bigint      not null default 0,
  igst_paise          bigint      not null default 0,
  round_off_paise     bigint      not null default 0,
  total_paise         bigint      not null default 0,
  amount_paid_paise   bigint      not null default 0,

  notes               text,
  terms               text,
  revision            int         not null default 0,
  last_edited_at      timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint invoices_supply_type_check
    check (supply_type in ('INTRA_STATE', 'INTRA_CITY', 'INTER_STATE')),
  constraint invoices_status_check
    check (status in ('DRAFT', 'SENT', 'PAID', 'PARTIALLY_PAID', 'CANCELLED'))
);

-- An invoice number is unique per company and can never be handed out twice.
create unique index if not exists invoices_company_number_key
  on public.invoices (company_id, number) where number is not null;

-- A sequence is unique within its own bucket, so September 0001 and October
-- 0001 can coexist while neither bucket ever reuses a number.
create unique index if not exists invoices_company_doc_bucket_seq_key
  on public.invoices (company_id, doc_type, seq_bucket, seq) where seq is not null;

create index if not exists invoices_company_date_idx   on public.invoices (company_id, invoice_date);
create index if not exists invoices_company_status_idx on public.invoices (company_id, status);

-- ---------------------------------------------------------------------------
-- invoice items
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_items (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references public.invoices(id) on delete cascade,
  product_id     uuid references public.products(id) on delete set null,

  name           text   not null,
  description    text,
  hsn_sac        text,
  unit           text   not null,
  qty_milli      bigint not null,          -- 2.5 units -> 2500
  rate_paise     bigint not null,
  discount_type  text   not null default 'PERCENT',
  discount_value bigint not null default 0,
  gross_paise    bigint not null,
  discount_paise bigint not null,
  taxable_paise  bigint not null,
  gst_rate       int    not null,
  cgst_paise     bigint not null,
  sgst_paise     bigint not null,
  igst_paise     bigint not null,
  total_paise    bigint not null,
  sort_order     int    not null default 0
);
create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id);

-- ---------------------------------------------------------------------------
-- payments
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices(id) on delete cascade,
  paid_on      date   not null,
  amount_paise bigint not null,
  method       text   not null default 'BANK_TRANSFER',
  reference    text,
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists payments_invoice_idx on public.payments (invoice_id);

-- ---------------------------------------------------------------------------
-- invoice revisions — what a bill looked like before each edit
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_revisions (
  id         uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  revision   int  not null,
  snapshot   jsonb not null,
  reason     text,
  created_at timestamptz not null default now(),
  constraint invoice_revisions_unique unique (invoice_id, revision)
);

-- ---------------------------------------------------------------------------
-- uploaded file metadata (the bytes live in Supabase Storage, not here)
-- ---------------------------------------------------------------------------
create table if not exists public.uploads (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies(id) on delete cascade,
  invoice_id   uuid references public.invoices(id) on delete set null,
  kind         text not null default 'attachment',  -- logo | signature | attachment
  file_name    text not null,
  content_type text,
  size_bytes   bigint,
  storage_path text not null,                        -- path inside the bucket
  uploaded_by  uuid,                                 -- auth.users(id) when auth is in use
  created_at   timestamptz not null default now()
);
create index if not exists uploads_company_idx on public.uploads (company_id);
create index if not exists uploads_invoice_idx on public.uploads (invoice_id);

-- =============================================================================
-- Atomic invoice numbering
--
-- The sequence is handed out by the database, inside the transaction that
-- writes the invoice, so two requests arriving at the same instant can never
-- receive the same number. The row-level lock taken by INSERT ... ON CONFLICT
-- DO UPDATE serialises concurrent callers on the same counter row.
-- =============================================================================
create or replace function public.next_invoice_sequence(
  p_company_id uuid,
  p_doc_type   text,
  p_bucket     text,
  p_start      int default 1
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq int;
begin
  insert into public.invoice_counters (company_id, doc_type, bucket, last_number)
  values (p_company_id, p_doc_type, p_bucket, greatest(1, p_start))
  on conflict (company_id, doc_type, bucket)
    do update set last_number = public.invoice_counters.last_number + 1,
                  updated_at  = now()
  returning last_number into v_seq;

  return v_seq;
end;
$$;

comment on function public.next_invoice_sequence is
  'Atomically reserves the next invoice sequence for a company + document type + bucket.';

-- Convenience: build the formatted number for the default format
--   {SELLERWORD}/{MMM}/{YY}/{SEQ}  ->  TRIVEDI/SEP/26/0001
create or replace function public.build_invoice_number(
  p_company_name text,
  p_date         date,
  p_seq          int,
  p_padding      int default 4
)
returns text
language sql
immutable
as $$
  -- p_company_name is the CUSTOMER being billed, matching {BUYERWORD}.
  select upper(regexp_replace(split_part(btrim(p_company_name), ' ', 1), '[^A-Za-z0-9]', '', 'g'))
      || '/' || upper(to_char(p_date, 'MON'))
      || '/' || to_char(p_date, 'YY')
      || '/' || lpad(p_seq::text, greatest(1, p_padding), '0');
$$;

-- Keeps updated_at honest on every write.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['companies', 'customers', 'products', 'invoices'] loop
    execute format(
      'drop trigger if exists %I_touch on public.%I;
       create trigger %I_touch before update on public.%I
       for each row execute function public.touch_updated_at();',
      t, t, t, t);
  end loop;
end $$;
