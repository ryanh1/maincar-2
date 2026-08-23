#!/usr/bin/env bash
# Regression coverage for the bounded gate scheduler. Run from any ticket clone:
#   ./.claude/scripts/coord/tests/mc-gate.test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
GATE="$ROOT/.claude/scripts/coord/mc-gate"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/mc-gate-test-XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/bin"
mkdir -p "$SANDBOX/primary"
cat > "$SANDBOX/bin/npm" <<'EOF'
#!/usr/bin/env bash
printf '%s|VITEST_MAX_WORKERS=%s|PLAYWRIGHT_WORKERS=%s\n' "$*" "${VITEST_MAX_WORKERS:-}" "${PLAYWRIGHT_WORKERS:-}" >> "$MC_FAKE_NPM_LOG"
sleep 1
EOF
chmod +x "$SANDBOX/bin/npm"

gate_env=(
  MC_STATE_HOME="$SANDBOX/state"
  MC_MAIN_CHECKOUT="$SANDBOX/primary"
  MC_FAKE_NPM_LOG="$SANDBOX/npm.log"
  PATH="$SANDBOX/bin:$PATH"
)

run_gate() {
  env "${gate_env[@]}" "$GATE" "$@"
}

if run_gate --focused -- npm run verify >"$SANDBOX/broad.out" 2>&1; then
  echo 'focused lane accepted a broad command' >&2
  exit 1
fi
grep -F 'focused checks must name one test file' "$SANDBOX/broad.out" >/dev/null

if run_gate --focused -- npm --prefix server exec playwright test src/routes/__tests__/auth.test.ts >"$SANDBOX/server-playwright.out" 2>&1; then
  echo 'focused lane accepted Playwright from the server workspace' >&2
  exit 1
fi
grep -F 'focused checks must name one test file' "$SANDBOX/server-playwright.out" >/dev/null

if run_gate --delivery npm run verify >"$SANDBOX/delivery-args.out" 2>&1; then
  echo 'delivery lane accepted an arbitrary command' >&2
  exit 1
fi
grep -F 'delivery does not accept a command' "$SANDBOX/delivery-args.out" >/dev/null

if run_gate >"$SANDBOX/no-class.out" 2>&1; then
  echo 'mc-gate accepted an implicit class' >&2
  exit 1
fi
grep -F 'choose --focused or --delivery explicitly' "$SANDBOX/no-class.out" >/dev/null

run_gate --focused -- npm --prefix vite exec vitest run src/pages/Records.test.tsx >"$SANDBOX/focused.out"
grep -F 'class focused' "$SANDBOX/focused.out" >/dev/null
grep -F 'VITEST_MAX_WORKERS=1' "$SANDBOX/npm.log" >/dev/null

# A live slot from the serial scheduler has no worker metadata. During rollout
# it must block new gates rather than be treated as free capacity.
legacy_slot="$SANDBOX/state/state/locks/gate/slot-legacy"
mkdir -p "$legacy_slot"
printf '%s\n' "$$" > "$legacy_slot/pid"
run_gate --focused -- npm --prefix vite exec vitest run src/pages/Records.test.tsx >"$SANDBOX/legacy.out" 2>&1 &
legacy_gate_pid=$!
sleep 1
grep -F 'focused lane is at capacity — queued' "$SANDBOX/legacy.out" >/dev/null
rm -rf "$legacy_slot"
wait "$legacy_gate_pid"

# Three repetitions of three competing gates prove the default admits exactly
# two six-worker deliveries at once and queues the third inside the 12-worker
# budget. The fake npm command makes this a deterministic scheduler benchmark.
for run in 1 2 3; do
  : > "$SANDBOX/npm.log"
  run_gate --delivery >"$SANDBOX/delivery-${run}-one.out" 2>&1 &
  first=$!
  run_gate --delivery >"$SANDBOX/delivery-${run}-two.out" 2>&1 &
  second=$!
  sleep 1
  run_gate --delivery >"$SANDBOX/delivery-${run}-three.out" 2>&1 &
  third=$!
  wait "$first"
  wait "$second"
  wait "$third"
  grep -F 'class delivery, slot' "$SANDBOX/delivery-${run}-one.out" >/dev/null
  grep -F 'limit 2, vitest=4, playwright=2, global budget=12' "$SANDBOX/delivery-${run}-one.out" >/dev/null
  grep -lF 'lane is at capacity — queued' "$SANDBOX/delivery-${run}-"*.out >/dev/null
  grep -F 'VITEST_MAX_WORKERS=4|PLAYWRIGHT_WORKERS=2' "$SANDBOX/npm.log" >/dev/null
done

if env "${gate_env[@]}" MC_GATE_OVERRIDE=1 MC_GATE_MACHINE_WORKERS=24 MC_GATE_GLOBAL_WORKER_BUDGET=16 MC_GATE_VITEST_WORKERS=8 MC_GATE_PLAYWRIGHT_WORKERS=1 "$GATE" --delivery >"$SANDBOX/over-budget.out" 2>&1; then
  echo 'delivery override exceeded the global worker budget' >&2
  exit 1
fi
grep -F 'exceeds global worker budget' "$SANDBOX/over-budget.out" >/dev/null

env "${gate_env[@]}" MC_GATE_OVERRIDE=1 MC_GATE_DELIVERY_LIMIT=1 "$GATE" --delivery >"$SANDBOX/override.out" 2>&1
grep -F 'WARNING: manual scheduler override is active' "$SANDBOX/override.out" >/dev/null

if ! grep -F '"$COORD_SCRIPTS_DIR/mc-gate" --delivery' "$ROOT/.claude/scripts/coord/mc-merge" >/dev/null; then
  echo 'mc-merge --gate can bypass the delivery class' >&2
  exit 1
fi

echo 'mc-gate bounded scheduler: PASS'
