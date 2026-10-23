# NexoFab — all three apps in ONE image (one Render service):
#
#   :8080  /           PDF Template Builder (static export; its API under /api)
#          /salary/    Salary Slip Generator  (Next.js, basePath=/salary)
#          /bills/     Bill Generator         (Next.js, basePath=/bills)
#
# nginx fronts three long-running processes managed by supervisord, so a
# single instance wake-up brings all three apps back together.
FROM node:20-bookworm-slim

ENV TZ=Asia/Kolkata
RUN apt-get update && apt-get install -y --no-install-recommends \
      nginx supervisor python3 python3-venv curl ca-certificates fonts-liberation fontconfig \
    && rm -rf /var/lib/apt/lists/*

# ---- 1. Salary Slip ---------------------------------------------------------
WORKDIR /app/salary
COPY apps/salary-slip/package.json apps/salary-slip/package-lock.json ./
# The postinstall hook runs `prisma generate`, so the schema must exist first.
COPY apps/salary-slip/prisma ./prisma
RUN npm ci
COPY apps/salary-slip/ ./
# Link and client fetch targets are inlined with this prefix at build time;
# the same value is given to the process at runtime for server-rendered pages.
ENV NEXT_PUBLIC_BASE_PATH=/salary
RUN npx prisma generate && npx next build

# ---- 2. Bill Generator ------------------------------------------------------
WORKDIR /app/bills
COPY apps/bill-generator/package.json apps/bill-generator/package-lock.json ./
RUN npm ci
COPY apps/bill-generator/ ./
ENV NEXT_PUBLIC_BASE_PATH=/bills
# Render injects the service's environment variables as build args with the
# same keys, so these get inlined into the client bundle on deploy; the
# defaults keep a local build working.
ARG NEXT_PUBLIC_SUPABASE_URL=""
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=""
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
# Every page that reads the database is force-dynamic, so the build needs no DB.
RUN npx prisma generate && npx next build

# ---- 3. Template Builder frontend (static export at the domain root) --------
WORKDIR /app/template/frontend
COPY apps/template-builder/frontend/package.json apps/template-builder/frontend/package-lock.json ./
RUN npm ci
COPY apps/template-builder/frontend/ ./
# build:static writes the site to /app/template/dist, with config.js set to
# apiUrl "same-origin" so the pages call /api on whatever host serves them.
RUN API_URL=same-origin npm run build:static

# ---- 4. Template Builder backend (FastAPI) ----------------------------------
WORKDIR /app/template/backend
COPY apps/template-builder/backend/requirements.txt ./
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
COPY apps/template-builder/backend/ ./
ENV PATH="/opt/venv/bin:$PATH"

# ---- 5. Reverse proxy + process manager -------------------------------------
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /etc/supervisord.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
