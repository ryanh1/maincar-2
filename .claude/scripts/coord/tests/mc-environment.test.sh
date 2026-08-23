#!/usr/bin/env bash
# Regression coverage for issue-clone environment provisioning and migration authoring.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
CLONE="$ROOT/.claude/scripts/coord/mc-clone"
MIGRATE="$ROOT/.claude/scripts/coord/mc-migrate"
SANDBOX="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/mc-environment-test-XXXXXX")" && pwd -P)"
trap 'rm -rf "$SANDBOX"' EXIT

git init --bare "$SANDBOX/upstream.git" --quiet
git init "$SANDBOX/primary" --quiet
git -C "$SANDBOX/primary" config user.name 'Environment test'
git -C "$SANDBOX/primary" config user.email 'environment-test@example.test'
git -C "$SANDBOX/primary" checkout -b main --quiet
printf '.env\n' > "$SANDBOX/primary/.gitignore"
printf 'DATABASE_URL=postgresql://postgres:postgres@localhost:5440/maincar2?schema=public\n' > "$SANDBOX/primary/.env"
touch "$SANDBOX/primary/tracked-placeholder"
git -C "$SANDBOX/primary" add .gitignore tracked-placeholder
git -C "$SANDBOX/primary" commit -m 'Initial main' --quiet
git -C "$SANDBOX/primary" remote add origin "$SANDBOX/upstream.git"
git -C "$SANDBOX/primary" push origin main --quiet

test_env=(
  MC_STATE_HOME="$SANDBOX/state"
  MC_MAIN_CHECKOUT="$SANDBOX/primary"
  MC_LOCAL_MAIN_REPO="$SANDBOX/state/local-main.git"
)
(cd "$SANDBOX/primary" && env "${test_env[@]}" "$ROOT/.claude/scripts/coord/mc-local-main" sync)

env "${test_env[@]}" "$CLONE" "$SANDBOX/issue-clone"
test -f "$SANDBOX/issue-clone/.env"
test ! -L "$SANDBOX/issue-clone/.env"
cmp -s "$SANDBOX/primary/.env" "$SANDBOX/issue-clone/.env"
printf 'MIGRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5440/primary-fallback\n' > "$SANDBOX/primary/.env"
if cmp -s "$SANDBOX/primary/.env" "$SANDBOX/issue-clone/.env"; then
  echo 'mc-clone linked .env instead of copying it' >&2
  exit 1
fi

mkdir -p "$SANDBOX/bin" "$SANDBOX/migration-clone/server/prisma/migrations"
cat > "$SANDBOX/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$MC_FAKE_DOCKER_LOG"
EOF
cat > "$SANDBOX/bin/npx" <<'EOF'
#!/usr/bin/env bash
printf 'DATABASE_URL=%s\nMIGRATE_DATABASE_URL=%s\nARGS=%s\n' "$DATABASE_URL" "$MIGRATE_DATABASE_URL" "$*" >> "$MC_FAKE_NPX_LOG"
EOF
chmod +x "$SANDBOX/bin/docker" "$SANDBOX/bin/npx"

git init "$SANDBOX/migration-clone" --quiet
git -C "$SANDBOX/migration-clone" config user.name 'Environment test'
git -C "$SANDBOX/migration-clone" config user.email 'environment-test@example.test'
git -C "$SANDBOX/migration-clone" checkout -b mai-463-environment-test --quiet
touch "$SANDBOX/migration-clone/placeholder"
git -C "$SANDBOX/migration-clone" add .
git -C "$SANDBOX/migration-clone" commit -m 'Migration fixture' --quiet
printf 'DATABASE_URL=postgresql://postgres:postgres@localhost:5440/maincar2?schema=public\n' > "$SANDBOX/migration-clone/.env"
mkdir -p "$SANDBOX/state/state"
: > "$SANDBOX/state/state/known-migration-timestamps.txt"

(cd "$SANDBOX/migration-clone" && \
  env "${test_env[@]}" \
    MC_SKIP_SCAN=1 \
    MC_FAKE_DOCKER_LOG="$SANDBOX/docker.log" \
    MC_FAKE_NPX_LOG="$SANDBOX/npx.log" \
    PATH="$SANDBOX/bin:$PATH" \
    "$MIGRATE" add_environment_guard)

grep -F 'CREATE DATABASE "maincar2_authoring_' "$SANDBOX/docker.log" >/dev/null
grep -F 'DATABASE_URL=postgresql://postgres:postgres@localhost:5440/maincar2_authoring_' "$SANDBOX/npx.log" >/dev/null
grep -F 'MIGRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5440/maincar2_authoring_' "$SANDBOX/npx.log" >/dev/null
if grep -F 'DATABASE_URL=postgresql://postgres:postgres@localhost:5440/maincar2?schema=public' "$SANDBOX/npx.log" >/dev/null; then
  echo 'mc-migrate authored against the configured database' >&2
  exit 1
fi

printf 'MIGRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5440/legacy-override?source=legacy\nDATABASE_URL=postgresql://postgres:postgres@localhost:5440/maincar2?source=database\n' > "$SANDBOX/migration-clone/.env"
(cd "$SANDBOX/migration-clone" && \
  env "${test_env[@]}" \
    MC_SKIP_SCAN=1 \
    MC_FAKE_DOCKER_LOG="$SANDBOX/docker.log" \
    MC_FAKE_NPX_LOG="$SANDBOX/npx.log" \
    PATH="$SANDBOX/bin:$PATH" \
    "$MIGRATE" add_legacy_override_guard)
grep -E 'DATABASE_URL=postgresql://postgres:postgres@localhost:5440/maincar2_authoring_[0-9]+\?source=legacy' "$SANDBOX/npx.log" >/dev/null

(cd "$SANDBOX/migration-clone" && \
  env "${test_env[@]}" \
    MC_SKIP_SCAN=1 \
    MC_MIGRATE_URL='postgresql://postgres:postgres@localhost:5440/explicit-override?source=explicit' \
    MC_FAKE_DOCKER_LOG="$SANDBOX/docker.log" \
    MC_FAKE_NPX_LOG="$SANDBOX/npx.log" \
    PATH="$SANDBOX/bin:$PATH" \
    "$MIGRATE" add_explicit_override_guard)
grep -E 'DATABASE_URL=postgresql://postgres:postgres@localhost:5440/maincar2_authoring_[0-9]+\?source=explicit' "$SANDBOX/npx.log" >/dev/null

echo 'mc environment setup and migration safety: PASS'
