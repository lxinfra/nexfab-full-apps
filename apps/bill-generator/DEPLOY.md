# Deploying to Netlify

## There is no `dist` folder, and there cannot be one

This app is server-rendered. Every page is dynamic, there are 20 API routes,
and both Prisma and the Supabase service-role key must stay on the server. A
static export (`next export` / `output: 'export'`) would drop all of it — no
invoice saving, no PDF generation, no imports.

Netlify handles this with its Next.js runtime, which is already configured in
[`netlify.toml`](netlify.toml). It compiles `.next` into Netlify Functions and
pushes the static chunks to the CDN. So:

- **Publish directory:** `.next` (not `dist`, not `out`)
- **Build command:** `npx prisma generate && npx next build`
- **Plugin:** `@netlify/plugin-nextjs` (a dev dependency, declared in `netlify.toml`)

You do not upload a folder by hand. Netlify builds from the repository.

## One-time setup

### 1. Push the repository

```bash
git init
git add .
git commit -m "GST bill generator"
git remote add origin <your-repo-url>
git push -u origin main
```

`.env` is git-ignored and must stay that way — the credentials go into
Netlify's own environment, not the repo.

### 2. Create the site

In Netlify: **Add new site → Import an existing project**, pick the repo. It
reads `netlify.toml`, so leave the build command and publish directory alone.

### 3. Set the environment variables

**Site configuration → Environment variables.** All five are required:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Supabase **pooler** connection string, port `6543`, with `?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | Supabase direct connection string, port `5432` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | the service-role key — **never** prefix this with `NEXT_PUBLIC_` |

#### Use the pooler, not the direct connection

This matters more on Netlify than it does locally. Each function invocation is
its own short-lived process; pointed at the direct Postgres host they will
exhaust the connection limit under any real traffic. Supabase's Supavisor
pooler exists for exactly this.

Get it from **Supabase → Project Settings → Database → Connection pooling**,
*Transaction* mode:

```
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres?sslmode=require"
```

Percent-encode special characters in the password (`@` → `%40`).

`connection_limit=1` is deliberate: with many concurrent function instances,
one connection each is what the pooler wants. `DIRECT_URL` is only used by
`prisma migrate` / `prisma db push`, never at runtime.

The direct host `db.<ref>.supabase.co` is also IPv6-only on new Supabase
projects, which is a second reason runtime traffic should go through the
pooler.

### 4. Deploy

Push to the tracked branch, or **Deploys → Trigger deploy**.

## Before the first deploy

Two things must be true, or the deployed site will work but look wrong.

### Move local uploads into Storage

Files under `public/uploads` are git-ignored and the serverless filesystem is
read-only, so anything still stored locally will not exist in production. Move
them:

```bash
npm run migrate:uploads
```

This uploads each logo and signature a company still references to the
`bill-files` bucket and rewrites the company row to point at the bucket path.
It is safe to re-run.

### Confirm the Supabase project is set up

```bash
npx tsx scripts/_apply-supabase-sql.ts   # bucket, RLS, numbering function
```

See [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md).

## What the config does and why

### `netlify.toml`

- `command` runs `prisma generate` first. The build imports `@prisma/client` at
  module load, and Netlify's dependency install does not reliably run Prisma's
  postinstall.
- `included_files = ["public/fonts/**"]` puts the TTF files inside the function
  bundle. `public/` normally goes to the CDN only, which the PDF renderer
  cannot read from.

### `prisma/schema.prisma`

```prisma
binaryTargets = ["native", "rhel-openssl-3.0.x"]
```

Netlify Functions run on AWS Lambda (Amazon Linux 2023). Without the second
target, every database call fails with *"Query engine library for current
platform could not be found."*

### `next.config.mjs`

```js
outputFileTracingIncludes: {
  '/api/invoices/[id]/pdf': ['./public/fonts/**'],
  '/api/invoices/import': ['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
}
```

Both files are opened through paths assembled at runtime, so Next's automatic
tracing cannot see them. Without these entries the PDF route throws *"unknown
font format"* and the bill importer throws *"fake worker failed"* — only once
deployed, which makes them unpleasant to debug.

## Function timeouts

Netlify Functions get 10 seconds by default on the free tier and up to 26
synchronously on paid plans. Two routes are slow:

- `POST /api/invoices/import` — parsing a scanned PDF bill
- `POST /api/imports/[id]/generate` — generating a month of invoices

The monthly generator processes in chunks and reports progress, so it stays
within the limit however large the sheet is. If PDF import of a large scan
times out, raise the function timeout in **Site configuration → Functions**.

## Checklist

- [ ] Repository pushed; `.env` not in it
- [ ] All five environment variables set in Netlify
- [ ] `DATABASE_URL` points at the **pooler** (`:6543`, `pgbouncer=true`)
- [ ] `npm run migrate:uploads` run, so no company still points at `/uploads/`
- [ ] Supabase bucket, RLS and numbering function applied
- [ ] Deploy green, then check: dashboard loads, a bill opens, its PDF
      downloads with the logo on it, and a new bill gets the next number

## Note on authentication

There is still none. Anyone with the URL can read and write every invoice.
Before putting this on a public domain, either put Netlify's password
protection / Identity in front of it, or add real auth. A deployed URL is not
the same risk as `localhost`.
