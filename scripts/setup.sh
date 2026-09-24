#!/bin/sh
# Prepares the Medusa database on every `docker compose up`; safe to repeat:
# - `medusa db:migrate`: runs the pending migrations of Medusa's modules and
#   syncs the module links and search indexes, without prompts (a new
#   MEDUSA_VERSION upgrades the schema here).
# - image/project/src/scripts/stack-setup.ts: the admin user if missing and,
#   once, the store settings (currency, region, tax, shipping, publishable
#   API key).
set -eu
cd /app

echo "==> Migrations"
# Without flags, syncing module links and search indexes asks interactively
# (and a container waits forever). Safe actions run by default; unsafe ones
# (dropping link tables or indexes) only with MEDUSA_MIGRATE_UNSAFE=true.
# --all-or-nothing reverts the migrations of this run if one fails.
if [ "${MEDUSA_MIGRATE_UNSAFE:-}" = true ]; then
    npx medusa db:migrate --all-or-nothing --execute-all-links --execute-all-search
else
    npx medusa db:migrate --all-or-nothing --execute-safe-links --execute-safe-search
fi

echo "==> Admin user and store settings"
npx medusa exec ./src/scripts/stack-setup.js

echo "==> Done: Medusa ${MEDUSA_VERSION}"
echo "    Admin: ${MEDUSA_URL}/app (${MEDUSA_ADMIN_EMAIL})"
echo "    Store API: ${MEDUSA_URL}/store (header x-publishable-api-key, see above)"
