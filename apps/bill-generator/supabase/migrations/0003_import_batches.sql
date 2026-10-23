-- Monthly sheet import: batches, rows, and the link from an invoice back to
-- the row it came from.
--
-- Prisma owns these tables (they were created with `prisma db push`); this file
-- is the equivalent SQL, for anyone setting the project up by hand or reviewing
-- what changed. It is written to be safe to run more than once.

create table if not exists public."ImportBatch" (
  id                  text primary key,
  "companyId"         text not null references public."Company"(id) on delete cascade,
  "fileName"          text not null,
  "fileHash"          text not null,
  "fileSize"          integer,
  "storagePath"       text,
  "periodMonth"       integer,
  "periodYear"        integer,
  status              text not null default 'PENDING',
  grouping            text not null default 'BILL_NO',
  mapping             text,
  "defaultSupplyType" text not null default 'INTRA_STATE',
  "totalRows"         integer not null default 0,
  "validRows"         integer not null default 0,
  "errorRows"         integer not null default 0,
  "billCount"         integer not null default 0,
  "invoiceCount"      integer not null default 0,
  issues              text,
  error               text,
  "createdAt"         timestamp(3) not null default current_timestamp,
  "generatedAt"       timestamp(3)
);

create index if not exists "ImportBatch_companyId_createdAt_idx"
  on public."ImportBatch" ("companyId", "createdAt");
-- The duplicate-upload check looks the hash up per company.
create index if not exists "ImportBatch_companyId_fileHash_idx"
  on public."ImportBatch" ("companyId", "fileHash");

create table if not exists public."ImportRow" (
  id               text primary key,
  "batchId"        text not null references public."ImportBatch"(id) on delete cascade,
  "rowNumber"      integer not null,
  raw              text not null,
  "billKey"        text,
  "externalBillNo" text,
  "customerName"   text,
  "itemName"       text,
  description      text,
  "hsnSac"         text,
  unit             text,
  "qtyMilli"       integer,
  "ratePaise"      integer,
  "gstRate"        integer,
  "supplyType"     text,
  "rowDate"        timestamp(3),
  status           text not null default 'VALID',
  issues           text,
  "invoiceId"      text references public."Invoice"(id) on delete set null,
  "createdAt"      timestamp(3) not null default current_timestamp
);

create index if not exists "ImportRow_batchId_rowNumber_idx"
  on public."ImportRow" ("batchId", "rowNumber");
-- Grouping rows into bills reads them by billKey.
create index if not exists "ImportRow_batchId_billKey_idx"
  on public."ImportRow" ("batchId", "billKey");
create index if not exists "ImportRow_invoiceId_idx"
  on public."ImportRow" ("invoiceId");

-- An invoice remembers which import produced it and what the sheet called it.
-- The sheet's own bill number is kept for tracing only; the invoice number
-- always comes from the application's own series.
alter table public."Invoice"
  add column if not exists "importBatchId" text references public."ImportBatch"(id) on delete set null,
  add column if not exists "externalBillNo" text;

create index if not exists "Invoice_importBatchId_idx"
  on public."Invoice" ("importBatchId");

-- Same posture as the existing tables: RLS on, no policies. The app reaches
-- Postgres with the database password, which bypasses RLS; the anon key, the
-- only one that could reach a browser, is granted nothing.
alter table public."ImportBatch" enable row level security;
alter table public."ImportRow" enable row level security;
