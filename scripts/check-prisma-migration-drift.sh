#!/usr/bin/env bash
# Fails when schema.prisma describes a database that the committed migrations
# cannot build. It uses a dedicated, disposable Postgres database because Prisma
# needs a shadow database to replay a migrations directory safely.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCHEMA_PATH="${PRISMA_SCHEMA_PATH:-$ROOT/server/prisma/schema.prisma}"
MIGRATIONS_PATH="${PRISMA_MIGRATIONS_PATH:-$ROOT/server/prisma/migrations}"
MIGRATE_URL="${MIGRATE_DATABASE_URL:-${DIRECT_DATABASE_URL:-${DATABASE_URL:-}}}"

if [ ! -f "$SCHEMA_PATH" ] || [ ! -d "$MIGRATIONS_PATH" ]; then
  echo "prisma migration guard: schema or migrations path is missing." >&2
  exit 1
fi

if [ -z "$MIGRATE_URL" ] && [ -r "$ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
  MIGRATE_URL="${MIGRATE_DATABASE_URL:-${DIRECT_DATABASE_URL:-${DATABASE_URL:-}}}"
fi

if [ -z "$MIGRATE_URL" ]; then
  echo "prisma migration guard: DATABASE_URL or MIGRATE_DATABASE_URL is required." >&2
  exit 1
fi

CONTAINER="${MC_PG_CONTAINER:-maincar2-postgres}"
GUARD_DATABASE="maincar2_prisma_guard_${$}_${RANDOM}"
SHADOW_URL="$(MIGRATE_URL="$MIGRATE_URL" GUARD_DATABASE="$GUARD_DATABASE" node -e '
  const url = new URL(process.env.MIGRATE_URL)
  url.pathname = `/${process.env.GUARD_DATABASE}`
  url.search = ""
  console.log(url.toString())
')"

cleanup() {
  docker exec "$CONTAINER" psql -U postgres -d postgres -q \
    -c "DROP DATABASE IF EXISTS \"$GUARD_DATABASE\" WITH (FORCE)" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker exec "$CONTAINER" psql -U postgres -d postgres -q \
  -c "CREATE DATABASE \"$GUARD_DATABASE\"" || {
    echo "prisma migration guard: could not create a disposable database on $CONTAINER." >&2
    exit 1
  }

set +e
(
  export DATABASE_URL="$MIGRATE_URL"
  export SHADOW_DATABASE_URL="$SHADOW_URL"
  cd "$ROOT/server"
  npx --no-install prisma migrate diff --from-migrations "$MIGRATIONS_PATH" --to-schema "$SCHEMA_PATH" --exit-code
)
STATUS=$?
set -e

if [ "$STATUS" -eq 2 ]; then
  echo "prisma migration guard: schema.prisma differs from the committed migrations. Create and commit a Prisma migration." >&2
  exit 1
fi

exit "$STATUS"
