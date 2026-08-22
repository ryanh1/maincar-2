#!/usr/bin/env bash
# Starts the Firebase Auth emulator, and does not lose your accounts doing it.
#
# The emulator runs with `--import data --export-on-exit data`, so the accounts you
# sign in with today are still there tomorrow. Two things break that on their own,
# and this script handles both.
#
# 1. `--export-on-exit` only runs on a CLEAN shutdown. Kill the parent `npm run dev`
#    hard, or lose the terminal, and the export never happens — every local account
#    is gone. So this wrapper checkpoints accounts while the emulator runs and
#    once more during its own clean shutdown.
#
# 2. firebase.json pins auth to a fixed port. The FIRST emulator to claim it wins.
#    A later one starts with a hub but NO auth emulator: it prints a cheerful banner
#    and then signs nobody in. A port owner may belong to another worktree, though,
#    so this launcher refuses loudly instead of killing a process it does not own.
#
# Accounts are read straight off the emulator's REST API rather than through
# `firebase emulators:export`, because that command follows a global hub locator
# file and will happily write an EMPTY export from somebody else's hollow emulator
# over your good one.
#
#   npm run dev            # via the root dev script
#   npm run firebase:dev   # just the emulator
#   npm run firebase:save  # checkpoint the accounts now, without restarting
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FB="$ROOT/firebase"
PROJECT="maincar-2"
PORT=9140
DATA_DIR="$FB/data"
EXPORT_DIR="$DATA_DIR/auth_export"
READY_FILE=""

log() { printf '[firebase] %s\n' "$*"; }

emulator_pids_on_port() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null || true
}

# Every port firebase.json pins, read from the file rather than hardcoded here, so
# adding an emulator to the config does not silently leave a port unmanaged.
#
# Checking ONLY the auth port is not enough. The emulators are separate processes
# — Firestore and Storage are JVMs — and every configured port must be free before
# a reliable emulator session can start.
declared_ports() {
  python3 - "$FB/firebase.json" <<'PY'
import json, sys
try:
    cfg = json.load(open(sys.argv[1])).get("emulators", {})
except Exception:
    raise SystemExit(0)
for name, entry in cfg.items():
    if isinstance(entry, dict) and isinstance(entry.get("port"), int):
        print(entry["port"])
PY
}

# Reads the accounts out of a LIVE emulator and writes them in the layout that
# `--import` expects: firebase-export-metadata.json beside an auth_export/ folder.
#
# Returns non-zero without touching the saved files when there is nothing worth
# saving. Overwriting a good export with an empty one is the failure this whole
# script exists to prevent, so it is guarded rather than assumed.
save_accounts_from_running_emulator() {
  local raw; raw="$(mktemp)"

  if ! curl -s -m 5 -X POST \
      "http://127.0.0.1:$PORT/identitytoolkit.googleapis.com/v1/projects/$PROJECT/accounts:query" \
      -H "Authorization: Bearer owner" -H "Content-Type: application/json" \
      -d '{}' -o "$raw"; then
    log "could not reach the emulator on $PORT; leaving the saved accounts alone"
    rm -f "$raw"; return 1
  fi

  mkdir -p "$EXPORT_DIR"

  # The version stamp has to match the firebase-tools doing the import, or the CLI
  # refuses the export directory.
  local version
  version="$(cd "$FB" && npx --no-install firebase --version 2>/dev/null | tail -1)"
  version="${version:-15.28.1}"

  python3 - "$raw" "$EXPORT_DIR" "$DATA_DIR" "$version" <<'PY'
import json, os, sys

raw, export_dir, data_dir, version = sys.argv[1:5]

try:
    src = json.load(open(raw))
except Exception:
    print("[firebase] the emulator returned nothing readable; saved accounts left alone")
    raise SystemExit(1)

users = []
for u in src.get("userInfo", []):
    u = dict(u)
    # Not part of the import schema, and the CLI rejects the file if it is present.
    u.pop("lastRefreshAt", None)
    u.setdefault("disabled", False)
    users.append(u)

if not users:
    # A good file is never replaced with an empty one. An emulator with no accounts
    # is far more often a hollow one that lost the port race than a real reset.
    print("[firebase] the emulator on this port has no accounts; saved accounts left alone")
    raise SystemExit(1)

def write(path, payload):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(payload, fh)
    os.replace(tmp, path)   # atomic, so an interrupted save cannot truncate the file

write(os.path.join(export_dir, "accounts.json"),
      {"kind": "identitytoolkit#DownloadAccountResponse", "users": users})

# Written only if absent, so a project that changed these settings keeps them.
config_path = os.path.join(export_dir, "config.json")
if not os.path.exists(config_path):
    write(config_path, {
        "signIn": {"allowDuplicateEmails": False},
        "emailPrivacyConfig": {"enableImprovedEmailPrivacy": False},
    })

write(os.path.join(data_dir, "firebase-export-metadata.json"),
      {"version": version, "auth": {"version": version, "path": "auth_export"}})

print(f"[firebase] saved {len(users)} account(s) to {export_dir}/accounts.json")
PY
  local rc=$?
  rm -f "$raw"
  return $rc
}

# `--save-only` checkpoints the running emulator and exits, restarting nothing.
if [ "${1:-}" = "--save-only" ]; then
  if [ -z "$(emulator_pids_on_port "$PORT")" ]; then
    log "nothing is running on $PORT, so there is nothing to save"
    exit 1
  fi
  save_accounts_from_running_emulator
  exit $?
fi

if [ "${1:-}" = "--ready-file" ]; then
  if [ "$#" -ne 2 ]; then
    log "ERROR: --ready-file needs a file path"
    exit 2
  fi
  READY_FILE="$2"
elif [ "$#" -ne 0 ]; then
  log "ERROR: unknown argument: $1"
  exit 2
fi

# --- Refuse occupied ports ---
# This used to terminate every listener on a configured port. That made one
# worktree's startup silently kill another's Firebase emulator, after which the
# API had no Auth service at all. We cannot establish ownership from a port
# number, so fail with the exact PIDs rather than making that destructive guess.
for port in $(declared_ports); do
  pids="$(emulator_pids_on_port "$port")"
  [ -z "$pids" ] && continue

  log "ERROR: port $port is already in use by pid(s): $pids"
  log "Refusing to stop a process this launcher did not start. Inspect it with:"
  log "  lsof -nP -iTCP:$port -sTCP:LISTEN"
  exit 1
done

# --- Start ---
# `--import` is only passed when there is a real export to import. Pointing it at an
# empty folder makes the CLI exit with "Could not find import directory", which on a
# fresh clone reads like a broken setup rather than an empty one.
cd "$FB"

if [ ! -f "$DATA_DIR/firebase-export-metadata.json" ]; then
  log "no saved accounts yet — starting empty, and saving as you go"
fi

# Two spelled-out branches rather than an args array: macOS still ships bash 3.2,
# where expanding an EMPTY array under `set -u` is an "unbound variable" error.
# `exec` replaces this subshell with the emulator, so $! below is the emulator's
# own pid and not a wrapper's.
start_emulator() {
  if [ -f "$DATA_DIR/firebase-export-metadata.json" ]; then
    exec npx --no-install firebase emulators:start \
      --config firebase.json --project "$PROJECT" \
      --import data --export-on-exit data
  else
    exec npx --no-install firebase emulators:start \
      --config firebase.json --project "$PROJECT" \
      --export-on-exit data
  fi
}

start_emulator &
EMULATOR_PID=$!

# A listening socket is not enough: the Auth emulator binds its port before it
# can answer token-verification requests. The local API and Vite proxy both use
# this endpoint, so a successful query is the readiness contract they need.
wait_for_auth_ready() {
  for _ in $(seq 1 60); do
    if curl -fsS -m 1 -X POST \
        "http://127.0.0.1:$PORT/identitytoolkit.googleapis.com/v1/projects/$PROJECT/accounts:query" \
        -H "Authorization: Bearer owner" -H "Content-Type: application/json" \
        -d '{}' -o /dev/null; then
      return 0
    fi

    if ! kill -0 "$EMULATOR_PID" 2>/dev/null; then
      log "ERROR: Firebase exited before Auth became ready"
      return 1
    fi
    sleep 1
  done

  log "ERROR: Firebase Auth did not become ready within 60 seconds"
  return 1
}

if ! wait_for_auth_ready; then
  kill "$EMULATOR_PID" 2>/dev/null || true
  wait "$EMULATOR_PID" 2>/dev/null || true
  exit 1
fi

if [ -n "$READY_FILE" ]; then
  : > "$READY_FILE"
  log "Firebase Auth is ready"
fi

# Checkpoint on a timer while the emulator runs.
#
# `--export-on-exit` only fires on a CLEAN shutdown, and saving before a restart
# only helps if the emulator is still alive to be read. Neither covers the case
# that actually loses work: the process is killed outright, or the machine sleeps
# and never wakes the terminal. Then the accounts are simply gone, and no amount of
# care at startup can bring them back.
#
# So the accounts are written to disk every AUTOSAVE_SECONDS. The save refuses to
# overwrite a good file with an empty one, so a tick that lands while the emulator
# is still booting costs nothing.
AUTOSAVE_SECONDS="${FIREBASE_AUTOSAVE_SECONDS:-60}"
(
  while sleep "$AUTOSAVE_SECONDS"; do
    save_accounts_from_running_emulator >/dev/null 2>&1 || true
  done
) &
AUTOSAVE_PID=$!

# On the way out: stop the timer, then take one last save before the emulator goes,
# so the final seconds of work are not the ones that get lost.
cleanup() {
  trap - EXIT INT TERM
  kill "$AUTOSAVE_PID" 2>/dev/null || true
  save_accounts_from_running_emulator >/dev/null 2>&1 || true
  kill "$EMULATOR_PID" 2>/dev/null || true
  wait "$EMULATOR_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait "$EMULATOR_PID"
