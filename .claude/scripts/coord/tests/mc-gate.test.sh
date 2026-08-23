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
printf '%s|VITEST_MAX_WORKERS=%s\n' "$*" "${VITEST_MAX_WORKERS:-}" >> "$MC_FAKE_NPM_LOG"
sleep 2
EOF
chmod +x "$SANDBOX/bin/npm"

# Delivery receipts deliberately require a committed ticket checkout. Keep the
# scheduler test isolated from this test file's own uncommitted RED/GREEN edits.
git init --bare "$SANDBOX/upstream.git" --quiet
git init "$SANDBOX/ticket" --quiet
git -C "$SANDBOX/ticket" config user.name 'Gate test'
git -C "$SANDBOX/ticket" config user.email 'gate-test@example.test'
git -C "$SANDBOX/ticket" checkout -b main --quiet
touch "$SANDBOX/ticket/fixture"
git -C "$SANDBOX/ticket" add fixture
git -C "$SANDBOX/ticket" commit -m 'Initial main' --quiet
git -C "$SANDBOX/ticket" remote add origin "$SANDBOX/upstream.git"
git -C "$SANDBOX/ticket" push -u origin main --quiet
git -C "$SANDBOX/ticket" checkout -b gate-receipt-test --quiet
git -C "$SANDBOX/ticket" commit --allow-empty -m 'Gate receipt fixture' --quiet

gate_env=(
  MC_STATE_HOME="$SANDBOX/state"
  MC_MAIN_CHECKOUT="$SANDBOX/primary"
  MC_FAKE_NPM_LOG="$SANDBOX/npm.log"
  PATH="$SANDBOX/bin:$PATH"
)

run_gate() {
  (cd "$SANDBOX/ticket" && env "${gate_env[@]}" "$GATE" "$@")
}

if run_gate --focused -- npm run verify >"$SANDBOX/broad.out" 2>&1; then
  echo 'focused lane accepted a broad command' >&2
  exit 1
fi
grep -F 'focused checks must name one Vitest file' "$SANDBOX/broad.out" >/dev/null

if run_gate --focused -- npm --prefix server exec playwright test src/routes/__tests__/auth.test.ts >"$SANDBOX/server-playwright.out" 2>&1; then
  echo 'focused lane accepted Playwright from the server workspace' >&2
  exit 1
fi
grep -F 'focused checks must name one Vitest file' "$SANDBOX/server-playwright.out" >/dev/null

if run_gate --focused -- npm --prefix vite exec playwright test src/pages/Records.spec.ts >"$SANDBOX/vite-playwright.out" 2>&1; then
  echo 'focused lane retained the unused Playwright reservation' >&2
  exit 1
fi
grep -F 'focused checks must name one Vitest file' "$SANDBOX/vite-playwright.out" >/dev/null

if run_gate --delivery >"$SANDBOX/per-session-delivery.out" 2>&1; then
  echo 'mc-gate retained per-session delivery validation' >&2
  exit 1
fi
grep -F 'delivery validation moved to mc-train' "$SANDBOX/per-session-delivery.out" >/dev/null

if run_gate >"$SANDBOX/no-class.out" 2>&1; then
  echo 'mc-gate accepted an implicit class' >&2
  exit 1
fi
grep -F 'choose --focused or --train explicitly' "$SANDBOX/no-class.out" >/dev/null

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

# Three repetitions of five competing train gates prove the default admits four
# real non-browser jobs at once and queues the fifth. No capacity is reserved
# for Playwright because the delivery train never runs it.
for run in 1 2 3; do
  : > "$SANDBOX/npm.log"
  run_gate --train --risk low --scope docs --coverage 'coordination docs' >"$SANDBOX/train-${run}-one.out" 2>&1 &
  first=$!
  run_gate --train --risk low --scope docs --coverage 'coordination docs' >"$SANDBOX/train-${run}-two.out" 2>&1 &
  second=$!
  run_gate --train --risk low --scope docs --coverage 'coordination docs' >"$SANDBOX/train-${run}-three.out" 2>&1 &
  third=$!
  run_gate --train --risk low --scope docs --coverage 'coordination docs' >"$SANDBOX/train-${run}-four.out" 2>&1 &
  fourth=$!
  sleep 1
  run_gate --train --risk low --scope docs --coverage 'coordination docs' >"$SANDBOX/train-${run}-five.out" 2>&1 &
  fifth=$!
  for job in one:$first two:$second three:$third four:$fourth five:$fifth; do
    name="${job%%:*}"
    pid="${job#*:}"
    if ! wait "$pid"; then
      echo "train gate $name failed during scheduler run $run" >&2
      sed 's/^/  /' "$SANDBOX/train-${run}-${name}.out" >&2
      exit 1
    fi
  done
  grep -F 'class train, slot' "$SANDBOX/train-${run}-one.out" >/dev/null
  grep -F 'limit 4, vitest=3' "$SANDBOX/train-${run}-one.out" >/dev/null
  grep -lF 'lane is at capacity — queued' "$SANDBOX/train-${run}-"*.out >/dev/null
  grep -F 'VITEST_MAX_WORKERS=3' "$SANDBOX/npm.log" >/dev/null
  if grep -F 'PLAYWRIGHT' "$SANDBOX/npm.log" >/dev/null; then
    echo 'train gate exported a Playwright worker reservation' >&2
    exit 1
  fi
done

# Risk policy is executable: low risk gets static checks, normal risk adds the
# relevant suite, and high risk runs the full verification exactly once.
: > "$SANDBOX/npm.log"
run_gate --train --risk low --scope docs --coverage 'coordination docs' >"$SANDBOX/low.out"
grep -Fx 'run typecheck|VITEST_MAX_WORKERS=3' "$SANDBOX/npm.log" >/dev/null
grep -Fx 'run lint|VITEST_MAX_WORKERS=3' "$SANDBOX/npm.log" >/dev/null
if grep -F 'run verify' "$SANDBOX/npm.log" >/dev/null; then
  echo 'low-risk train ran full verification' >&2
  exit 1
fi

: > "$SANDBOX/npm.log"
run_gate --train --risk normal --scope server --coverage 'server routes' --test server:src/routes/__tests__/auth.test.ts >"$SANDBOX/normal.out"
grep -F -- '--prefix server exec vitest run src/routes/__tests__/auth.test.ts' "$SANDBOX/npm.log" >/dev/null
grep -F 'run test:server' "$SANDBOX/npm.log" >/dev/null

: > "$SANDBOX/npm.log"
run_gate --train --risk high --scope full --coverage 'shared coordination infrastructure' >"$SANDBOX/high.out"
test "$(grep -cF 'run verify' "$SANDBOX/npm.log")" -eq 1

if (cd "$SANDBOX/ticket" && env "${gate_env[@]}" MC_GATE_OVERRIDE=1 MC_GATE_MACHINE_WORKERS=18 MC_GATE_RESERVED_SYSTEM_WORKERS=6 MC_GATE_JOB_LIMIT=5 MC_GATE_VITEST_WORKERS=3 "$GATE" --train --risk low --scope docs --coverage docs >"$SANDBOX/over-budget.out" 2>&1); then
  echo 'train override exceeded the real worker budget' >&2
  exit 1
fi
grep -F 'exceeds available worker capacity' "$SANDBOX/over-budget.out" >/dev/null

(cd "$SANDBOX/ticket" && env "${gate_env[@]}" MC_GATE_OVERRIDE=1 MC_GATE_JOB_LIMIT=1 "$GATE" --train --risk low --scope docs --coverage docs >"$SANDBOX/override.out" 2>&1)
grep -F 'WARNING: manual scheduler override is active' "$SANDBOX/override.out" >/dev/null

if grep -F 'npm run verify' "$ROOT/.claude/scripts/coord/mc-train" >/dev/null; then
  echo 'mc-train must delegate verification before it enters the merge slot' >&2
  exit 1
fi

lock_line="$(grep -nF 'mc_lock_acquire "$merge_lock"' "$ROOT/.claude/scripts/coord/mc-train" | cut -d: -f1)"
if tail -n "+$lock_line" "$ROOT/.claude/scripts/coord/mc-train" | grep -F 'run_gate_for_repo' >/dev/null; then
  echo 'mc-train retained test execution after acquiring the merge slot' >&2
  exit 1
fi

if grep -F 'mc_lock_acquire "$merge_lock" 3600' "$ROOT/.claude/scripts/coord/mc-train" >/dev/null; then
  echo 'mc-train retained a long test-and-merge lock path' >&2
  exit 1
fi

echo 'mc-gate risk scheduler: PASS'
