#!/bin/sh
# supervisord's %(ENV_X)s interpolation needs every referenced variable to
# exist. Give each an empty default so an app that is not yet configured
# starts and reports its own problem, instead of blocking the whole stack.
set -e
for v in \
  SALARY_DATABASE_URL SALARY_DIRECT_URL \
  BILL_DATABASE_URL BILL_DIRECT_URL \
  NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY \
  BILL_SUPABASE_SERVICE_ROLE_KEY BILL_STORAGE_BUCKET \
  TPL_DATABASE_URL TPL_SUPABASE_URL TPL_SUPABASE_SERVICE_KEY \
  TPL_CORS_ORIGINS TPL_ALLOW_SIGNUP
do
  eval ": \${$v:=}"
  export "$v"
done

exec supervisord -c /etc/supervisord.conf
