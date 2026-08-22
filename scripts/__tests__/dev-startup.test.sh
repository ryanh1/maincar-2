#!/usr/bin/env bash
# Guards the local-dev startup contract: Auth must be ready before its consumers
# begin. The test intentionally examines the public npm commands, because a new
# shortcut that bypasses the bootstrap would reintroduce the same race.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

fail() {
  printf 'dev-startup guard: %s\n' "$*" >&2
  exit 1
}

expected_dev='bash scripts/dev.sh'
expected_tunnel='bash scripts/dev.sh --tunnel'
actual_dev="$(node -p "require('${ROOT}/package.json').scripts.dev")"
actual_tunnel="$(node -p "require('${ROOT}/package.json').scripts['dev:tunnel']")"

[ "$actual_dev" = "$expected_dev" ] || fail "npm run dev bypasses the readiness bootstrap"
[ "$actual_tunnel" = "$expected_tunnel" ] || fail "npm run dev:tunnel bypasses the readiness bootstrap"

BOOTSTRAP="$ROOT/scripts/dev.sh"
[ -f "$BOOTSTRAP" ] || fail "the readiness bootstrap is missing"

grep -Fq 'firebase-emulator.sh" --ready-file "$READY_FILE"' "$BOOTSTRAP" ||
  fail "the bootstrap does not launch Firebase with a readiness signal"
grep -Fq 'wait_for_ready_file' "$BOOTSTRAP" ||
  fail "the bootstrap does not wait for Firebase readiness"
grep -Fq 'npm run docker:up' "$BOOTSTRAP" ||
  fail "the bootstrap does not start Docker before the API"
grep -Fq 'npm --prefix server run db:deploy' "$BOOTSTRAP" ||
  fail "the bootstrap does not apply Prisma migrations before the API"
grep -Fq 'concurrently' "$BOOTSTRAP" ||
  fail "the bootstrap does not start the API and web processes after readiness"

EMULATOR="$ROOT/scripts/firebase-emulator.sh"
grep -Fq 'wait_for_auth_ready' "$EMULATOR" ||
  fail "Firebase does not verify Auth is usable before signaling readiness"
grep -Fq 'accounts:query' "$EMULATOR" ||
  fail "Firebase readiness is not checked against the Auth API"
grep -Fq 'npx --no-install firebase emulators:start' "$EMULATOR" ||
  fail "Firebase startup can download or invoke the wrong package"
grep -Fq 'Refusing to stop a process this launcher did not start' "$EMULATOR" ||
  fail "Firebase startup can terminate a process it does not own"
grep -Fq 'kill -9 $(emulator_pids_on_port' "$EMULATOR" &&
  fail "Firebase startup force-kills any process holding an emulator port"

# Exercise the ordering with fakes instead of starting Docker or Firebase in the
# test suite. The fake Firebase process waits briefly before creating the exact
# file requested by the bootstrap; the fake concurrently command fails if it was
# launched before that file existed.
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
mkdir -p "$TEST_DIR/bin"

cat > "$TEST_DIR/bin/bash" <<'SH'
#!/bin/bash
if [ "$1" = "$PROJECT_ROOT/scripts/firebase-emulator.sh" ]; then
  [ "$2" = "--ready-file" ] || exit 21
  sleep 1
  : > "$3"
  printf '%s\n' "$3" > "$TEST_STATE_DIR/ready-path"
  while :; do sleep 60; done
fi
exec /bin/bash "$@"
SH

cat > "$TEST_DIR/bin/npx" <<'SH'
#!/bin/bash
READY_PATH="$(cat "$TEST_STATE_DIR/ready-path")"
[ -f "$READY_PATH" ] || exit 22
[ -f "$TEST_STATE_DIR/migrations-applied" ] || exit 23
printf 'concurrently started after Firebase readiness\n'
SH

cat > "$TEST_DIR/bin/npm" <<'SH'
#!/bin/bash
if [ "$1" = "run" ] && [ "$2" = "docker:up" ]; then
  : > "$TEST_STATE_DIR/docker-ready"
  exit 0
fi
if [ "$1" = "--prefix" ] && [ "$2" = "server" ] && [ "$3" = "run" ] && [ "$4" = "db:deploy" ]; then
  [ -f "$TEST_STATE_DIR/docker-ready" ] || exit 24
  [ "${TEST_FORCE_MIGRATION_FAILURE:-0}" != 1 ] || exit 25
  : > "$TEST_STATE_DIR/migrations-applied"
  exit 0
fi
exit 26
SH

chmod +x "$TEST_DIR/bin/bash" "$TEST_DIR/bin/npx" "$TEST_DIR/bin/npm"
PROJECT_ROOT="$ROOT" TEST_STATE_DIR="$TEST_DIR" PATH="$TEST_DIR/bin:$PATH" \
  /bin/bash "$BOOTSTRAP" >/dev/null || fail "API/web startup was not gated on Firebase readiness"

# Remove the new migration command from a temporary copy to prove the old
# startup path fails before concurrently can launch the API.
OLD_BOOTSTRAP="$TEST_DIR/dev-without-migrations.sh"
sed '/npm --prefix server run db:deploy/d' "$BOOTSTRAP" > "$OLD_BOOTSTRAP"
rm -f "$TEST_DIR/migrations-applied"
if PROJECT_ROOT="$ROOT" TEST_STATE_DIR="$TEST_DIR" PATH="$TEST_DIR/bin:$PATH" \
  /bin/bash "$OLD_BOOTSTRAP" >/dev/null 2>&1; then
  fail "API/web startup accepted a missing migration step"
fi

rm -f "$TEST_DIR/migrations-applied"
if PROJECT_ROOT="$ROOT" TEST_STATE_DIR="$TEST_DIR" TEST_FORCE_MIGRATION_FAILURE=1 PATH="$TEST_DIR/bin:$PATH" \
  /bin/bash "$BOOTSTRAP" >/dev/null 2>&1; then
  fail "API/web startup continued after a migration failure"
fi

# The schema guard receives Prisma exit status 2 for a schema that lacks a
# migration. It must turn that into a failing verification command.
GUARD="$ROOT/scripts/check-prisma-migration-drift.sh"
cat > "$TEST_DIR/bin/docker" <<'SH'
#!/bin/bash
exit 0
SH
cat > "$TEST_DIR/bin/npx" <<'SH'
#!/bin/bash
case " $* " in
  *' prisma migrate diff '*) exit "${TEST_PRISMA_DIFF_STATUS:-0}" ;;
  *) exit 27 ;;
esac
SH
chmod +x "$TEST_DIR/bin/docker" "$TEST_DIR/bin/npx"
if MIGRATE_DATABASE_URL='postgresql://postgres:postgres@localhost:5440/maincar2' \
  TEST_PRISMA_DIFF_STATUS=2 PATH="$TEST_DIR/bin:$PATH" /bin/bash "$GUARD" >/dev/null 2>&1; then
  fail "migration-drift guard accepted a schema with no migration"
fi
MIGRATE_DATABASE_URL='postgresql://postgres:postgres@localhost:5440/maincar2' \
  TEST_PRISMA_DIFF_STATUS=0 PATH="$TEST_DIR/bin:$PATH" /bin/bash "$GUARD" >/dev/null ||
  fail "migration-drift guard rejected matching schema and migrations"

printf 'dev-startup guard: passed\n'
