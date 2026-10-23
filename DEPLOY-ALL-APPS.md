# NexoFab full app bundle

This ZIP contains the NexoFab website and source for all three internal apps. It is a source deployment bundle, not a prebuilt Windows or GoDaddy server image. It excludes local `node_modules`, build output, local databases, `.env` files, and machine-specific Python environments.

## Recommended: one Render service runs all three apps

The bundle ships a `Dockerfile` plus `render.yaml`: one web service starts nginx, and nginx fronts all three apps on a single address. One instance sleep/wake covers everything — when Render wakes the service, Salary Slip, Bill Generator and Template Builder all come back together.

| Address | App |
|---|---|
| `https://<service>.onrender.com/` | PDF Template Builder (its API under `/api`) |
| `https://<service>.onrender.com/salary/` | Salary Slip Generator |
| `https://<service>.onrender.com/bills/` | Bill Generator |

Steps:

1. Put this bundle in a Git repository (or use Render's "upload" deploy) — the repo needs only this folder.
2. In Render: **New + Web Service**, connect the repo, runtime **Docker**. Render picks up `render.yaml` (Blueprint) automatically, or you can paste its environment keys by hand.
3. Fill the environment variables (names are namespaced per app — see `.env.example` for placeholders):

   | Variable | Value |
   |---|---|
   | `SALARY_DATABASE_URL`, `SALARY_DIRECT_URL` | Salary project's Supabase pooler/direct URLs, with `?schema=salary` |
   | `BILL_DATABASE_URL`, `BILL_DIRECT_URL` | Bill Generator project's Supabase pooler/direct URLs |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Bill Generator project's public API values |
   | `BILL_SUPABASE_SERVICE_ROLE_KEY` | Bill Generator project's service_role key |
   | `TPL_DATABASE_URL`, `TPL_SUPABASE_URL`, `TPL_SUPABASE_SERVICE_KEY` | Template project's Supabase values |

4. Deploy. The first build takes ~10 minutes (three Next.js builds + the Python backend).
5. One-time databases: the Salary Slip schema is synced and seeded automatically on every start. For the Bill Generator, run `npx prisma db push` once against `BILL_DATABASE_URL` (from any machine, or ask before first launch), and make sure its `bill-files` Storage bucket exists.

Render injects the environment variables as Docker build arguments too, so `NEXT_PUBLIC_*` values are inlined into the client bundle at build time — change them by re-deploying.

## Alternative: traditional VPS (the old way)

## Important hosting requirement

Use a VPS or server that supports Node.js 20+, Python 3.11+, persistent storage, and long-running services. The Template Builder has a FastAPI/Python backend. Node.js hosting by itself cannot run that backend. The Bill Generator requires PostgreSQL plus Supabase Storage/Auth configuration. The Salary Slip Maker uses Supabase Postgres (its tables live in a dedicated `salary` schema). The apps require working production database and storage configuration before using real company data.

The launcher runs the three Next.js servers and the Template Builder backend on local ports. For public access, put a reverse proxy such as Nginx in front of them and use HTTPS subdomains, for example:

| Service | Local port | Public address to set in the NexoFab website Admin |
|---|---:|---|
| Salary Slip Maker | 3101 | `https://salary.your-domain` |
| Bill Generator | 3102 | `https://bills.your-domain` |
| Template Builder frontend | 3103 | `https://templates.your-domain` |
| Template Builder API | 8000 | `https://templates-api.your-domain` |

The website's Admin page embeds those public app addresses inside the admin panel (each app page also offers an "Open in new tab" link, and each card shows an Online/Offline status). Set `SALARY_SLIP_URL`, `BILL_GENERATOR_URL`, and `TEMPLATE_BUILDER_URL` in the website process environment. The launcher does not create DNS records, TLS certificates, reverse proxy rules, or databases. Note that a shared cPanel Node.js host (such as GoDaddy's standard Node.js plan) runs only the website itself — it cannot run these app services; use a VPS or separate app hosting for them.

## Install and build

From the bundle root, install the portal and app dependencies:

```sh
node deploy-all.js install
```

Install Python 3.11+, then install the Template Builder backend dependencies:

```sh
python -m venv apps/template-builder/backend/.venv
# Linux/macOS:
apps/template-builder/backend/.venv/bin/pip install -r apps/template-builder/backend/requirements.txt
# Windows PowerShell:
# apps/template-builder/backend/.venv/Scripts/python.exe -m pip install -r apps/template-builder/backend/requirements.txt
```

Configure secrets and database URLs in the hosting provider's environment settings, not in source control. For the Bill Generator, set `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` as documented in `apps/bill-generator/DEPLOY.md`. Run its Prisma schema/database setup against the production database before launch.

For the Template Builder backend, configure `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET`, and `CORS_ORIGINS` as needed, following `apps/template-builder/backend/.env.example`. Add `NEXT_PUBLIC_API_URL=https://templates-api.your-domain` to the environment before building its frontend. The value is embedded at build time. Configure CORS to allow the public template frontend origin.

The Salary Slip Maker's `start` command syncs its schema to the configured database and seeds the first company when the database is empty. Set its `DATABASE_URL` (Supabase pooler, session mode, port 5432) and `DIRECT_URL` (direct connection) as documented in `apps/salary-slip/.env.example`, including the `?schema=salary` suffix so its tables stay separate from the Bill Generator's.

Then build the frontends:

```sh
node deploy-all.js build
```

## Start the services

Set `PYTHON_BIN` to the installed Python executable if it is not named `python3` (Linux/macOS) or `python` (Windows). Use the virtual-environment Python executable when dependencies were installed there. Then run:

```sh
node deploy-all.js start
```

Start the NexoFab website with `npm start` and the app services with `npm run start:apps`. Run both under a VPS process manager (such as systemd or PM2) so they restart after a reboot or crash. The app launcher keeps app services on localhost ports; use a reverse proxy to publish them securely. A cPanel shared Node.js app may not allow child services or extra listening ports; check the plan before uploading. If it does not, deploy the apps separately to hosts that support their respective runtimes and enter their public URLs on the NexoFab Admin page.

The initial Admin credentials for the website are configured separately in the website's GoDaddy environment (`ADMIN_USERNAME`, `ADMIN_PASSWORD`). Rotate the provided initial password before making the Admin page public.
