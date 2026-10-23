# Connecting this app to your Supabase project

The application currently runs on SQLite via Prisma and stores uploads on disk.
Everything below switches it to your own Supabase project. Nothing here has been
run against a live project — no credentials were available — so treat it as a
checklist to work through, not something already applied.

## 1. Environment variables

Copy `.env.example` to `.env` and fill it in. Nothing is hard-coded in source.

| Variable | Where to find it | Exposed to the browser? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API → Project URL | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → API → anon public | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → service_role | **no — server only** |
| `SUPABASE_STORAGE_BUCKET` | `bill-files` | no |
| `DATABASE_URL` | Project Settings → Database → Connection string (pooler, port 6543) | no |
| `DIRECT_URL` | same, direct connection on port 5432 | no |

`.env` and `.env.local` are git-ignored.

## 2. Run the SQL

In the Supabase SQL editor, run in order:

1. `supabase/migrations/0001_schema.sql` — tables, constraints, indexes, and the
   `next_invoice_sequence` / `build_invoice_number` functions.
2. `supabase/migrations/0002_storage_and_rls.sql` — the `bill-files` bucket,
   plus Row Level Security.

Read the comment block at the top of 0002 before running it: it offers
**Option A** (no authentication — RLS on, no policies, all access through the
server with the service-role key) and **Option B** (Supabase Auth, scoped by
`owner_id`). Option A matches the app as it stands today, because there is no
login. Option B is commented out and ready for when you add one.

## 3. Point Prisma at Postgres

In `prisma/schema.prisma`:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

Then:

```bash
npx prisma generate
npx prisma migrate deploy     # or: npx prisma db push
```

The SQL in step 2 and the Prisma schema describe the same tables. If you let
Prisma own the schema, run step 2 only for the storage bucket, the RLS block and
the two functions.

## 4. Storage

Bucket: **`bill-files`**, private, 10 MB per file.

Files are stored under `<company-id>/<kind>-<timestamp>-<random>.<ext>`. The
leading company id is what the Option B storage policies scope on. Only the path
is written to the `uploads` table — file bytes never go into a row. Private
objects are served through short-lived signed URLs.

Until `NEXT_PUBLIC_SUPABASE_URL` and a key are set, uploads fall back to
`public/uploads` on disk and `uploads.backend` records `local`, so the app keeps
working before and during the migration.

## 5. Invoice numbering on the database side

The default number format is `{BUYERWORD}/{MMM}/{YY}/{SEQ}` — the first word of
the **customer** being billed, the month, the two-digit year, and a four-digit
sequence that restarts for each customer each month. The counter bucket is
`<year>-<month>|<customer-id>`.

`public.next_invoice_sequence(company_id, doc_type, bucket, start)` reserves the
next sequence atomically. The `INSERT … ON CONFLICT DO UPDATE … RETURNING` takes
a row lock on the counter, so simultaneous callers queue rather than collide,
and `invoices_company_number_key` makes a duplicate number impossible even if
something went wrong above it.

The app's own `allocateSequence` already does exactly this through Prisma
(`upsert` + `increment` inside the invoice transaction), which is why concurrent
creation is safe today on SQLite as well — six simultaneous requests were tested
and produced 0001–0006 with no duplicates.
