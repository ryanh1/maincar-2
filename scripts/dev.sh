#!/usr/bin/env bash
# Starts Firebase first, then starts the processes that authenticate through it.
# The readiness file is created by firebase-emulator.sh only after Auth can answer
# requests; merely waiting for port 9140 would recreate the original race.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

if [ "${1:-}" = "--tunnel" ]; then
  npx --no-install concurrently --kill-others-on-fail \
    -n docker,vite,server,tunnel -c blue,cyan,green,magenta \
    "npm run docker:up" "npm --prefix vite run dev" "npm --prefix server run dev" "npm run tunnel" &
elif [ "$#" -eq 0 ]; then
  npx --no-install concurrently --kill-others-on-fail \
    -n docker,vite,server -c blue,cyan,green \
    "npm run docker:up" "npm --prefix vite run dev" "npm --prefix server run dev" &
else
  printf '[dev] Unknown argument: %s\n' "$1" >&2
  exit 2
fi
DEV_PID=$!
wait "$DEV_PID"
