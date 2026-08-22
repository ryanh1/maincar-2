#!/usr/bin/env bash
# Starts Firebase first, then starts the processes that authenticate through it.
# The readiness file is created by firebase-emulator.sh only after Auth can answer
# requests; merely waiting for port 9140 would recreate the original race.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Each issue clone has its own ignored dependency trees. An interrupted install
# can leave an executable present while a transitive module is missing, which
# otherwise turns into an opaque Firebase stack trace after startup begins.
check_local_dependencies() {
  local missing=()

  check_resolvable() {
    local label="$1"
    local module_path="$2"
    node -e 'require.resolve(process.argv[1])' "$module_path" >/dev/null 2>&1 ||
      missing+=("$label")
  }

  check_resolvable 'root (concurrently)' "$ROOT/node_modules/concurrently/package.json"
  check_resolvable 'server (prisma)' "$ROOT/server/node_modules/prisma/package.json"
  check_resolvable 'server (tsx)' "$ROOT/server/node_modules/tsx/package.json"
  check_resolvable 'web (vite)' "$ROOT/vite/node_modules/vite/package.json"
  check_resolvable 'Firebase (firebase-tools)' "$ROOT/firebase/node_modules/firebase-tools/package.json"

  if ! node -e 'require(process.argv[1])' \
    "$ROOT/firebase/node_modules/firebase-tools/lib/emulator/controller.js" \
    >/dev/null 2>&1; then
    missing+=('Firebase emulator dependency tree')
  fi

  [ "${#missing[@]}" -eq 0 ] && return 0

  printf '[dev] Local dependencies are missing or incomplete: %s\n' "${missing[*]}" >&2
  printf '[dev] Restore this worktree from its lockfiles:\n' >&2
  printf '[dev]   npm ci && npm --prefix server ci && npm --prefix vite ci && npm --prefix firebase ci\n' >&2
  exit 1
}

check_local_dependencies

READY_FILE="$(mktemp "${TMPDIR:-/tmp}/maincar-firebase-ready.XXXXXX")"
rm -f "$READY_FILE"
FIREBASE_PID=""
DEV_PID=""

cleanup() {
  trap - EXIT INT TERM
  [ -z "$DEV_PID" ] || kill "$DEV_PID" 2>/dev/null || true
  [ -z "$FIREBASE_PID" ] || kill "$FIREBASE_PID" 2>/dev/null || true
  [ -z "$DEV_PID" ] || wait "$DEV_PID" 2>/dev/null || true
  [ -z "$FIREBASE_PID" ] || wait "$FIREBASE_PID" 2>/dev/null || true
  rm -f "$READY_FILE"
}
trap cleanup EXIT INT TERM

wait_for_ready_file() {
  for _ in $(seq 1 65); do
    [ -f "$READY_FILE" ] && return 0
    if ! kill -0 "$FIREBASE_PID" 2>/dev/null; then
      wait "$FIREBASE_PID" || true
      return 1
    fi
    sleep 1
  done

  printf '[dev] Firebase did not signal readiness within 65 seconds.\n' >&2
  return 1
}

bash "$ROOT/scripts/firebase-emulator.sh" --ready-file "$READY_FILE" &
FIREBASE_PID=$!

wait_for_ready_file || exit 1

# Start Docker and apply every committed Prisma migration before the API can
# connect. This makes a stale local database fail here instead of later in a
# request handler (for example, a raw query selecting a new column).
npm run docker:up
npm --prefix server run db:deploy

if [ "${1:-}" = "--tunnel" ]; then
  npx --no-install concurrently --kill-others-on-fail \
    -n vite,server,tunnel -c cyan,green,magenta \
    "npm --prefix vite run dev" "npm --prefix server run dev" "npm run tunnel" &
elif [ "$#" -eq 0 ]; then
  npx --no-install concurrently --kill-others-on-fail \
    -n vite,server -c cyan,green \
    "npm --prefix vite run dev" "npm --prefix server run dev" &
else
  printf '[dev] Unknown argument: %s\n' "$1" >&2
  exit 2
fi
DEV_PID=$!
wait "$DEV_PID"
