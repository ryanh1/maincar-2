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
printf 'concurrently started after Firebase readiness\n'
SH

chmod +x "$TEST_DIR/bin/bash" "$TEST_DIR/bin/npx"
PROJECT_ROOT="$ROOT" TEST_STATE_DIR="$TEST_DIR" PATH="$TEST_DIR/bin:$PATH" \
  /bin/bash "$BOOTSTRAP" >/dev/null || fail "API/web startup was not gated on Firebase readiness"

printf 'dev-startup guard: passed\n'
