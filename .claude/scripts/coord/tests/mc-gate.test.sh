#!/usr/bin/env bash
# Regression coverage for the small shared check scheduler.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
GATE="$ROOT/.claude/scripts/coord/mc-gate"
SANDBOX="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/mc-gate-test-XXXXXX")" && pwd -P)"
trap 'rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/bin" "$SANDBOX/primary" "$SANDBOX/ticket/server/src" "$SANDBOX/ticket/vite/src" "$SANDBOX/ticket/checks"
cat > "$SANDBOX/bin/npm" <<'EOF'
#!/usr/bin/env bash
printf '%s|%s|VITEST_MAX_WORKERS=%s\n' "$PWD" "$*" "${VITEST_MAX_WORKERS:-}" >> "$MC_FAKE_NPM_LOG"
sleep "${MC_FAKE_SLEEP:-0}"
EOF
chmod +x "$SANDBOX/bin/npm"

cat > "$SANDBOX/ticket/checks/example.test.sh" <<'EOF'
#!/usr/bin/env bash
printf 'shell check ran\n' >> "$MC_FAKE_NPM_LOG"
EOF
chmod +x "$SANDBOX/ticket/checks/example.test.sh"
touch "$SANDBOX/ticket/server/src/example.test.ts" "$SANDBOX/ticket/server/src/example.integration.test.ts" "$SANDBOX/ticket/vite/src/example.test.tsx"

git init "$SANDBOX/ticket" --quiet
git -C "$SANDBOX/ticket" config user.name 'Gate test'
git -C "$SANDBOX/ticket" config user.email 'gate-test@example.test'
git -C "$SANDBOX/ticket" checkout -b mai-100-gate-test --quiet
git -C "$SANDBOX/ticket" add .
git -C "$SANDBOX/ticket" commit -m 'Gate fixture' --quiet

gate_env=(
  MC_STATE_HOME="$SANDBOX/state"
  MC_MAIN_CHECKOUT="$SANDBOX/primary"
  MC_FAKE_NPM_LOG="$SANDBOX/npm.log"
  PATH="$SANDBOX/bin:$PATH"
)
run_gate() { (cd "$SANDBOX/ticket" && env "${gate_env[@]}" "$GATE" "$@"); }

if run_gate --focused -- npm run verify >"$SANDBOX/broad.out" 2>&1; then
  echo 'focused checks accepted a broad command' >&2
  exit 1
fi
grep -F 'focused checks must name one Vitest file' "$SANDBOX/broad.out" >/dev/null

: > "$SANDBOX/npm.log"
run_gate --focused -- npm --prefix vite exec vitest run src/example.test.tsx >"$SANDBOX/focused.out"
grep -F 'class focused' "$SANDBOX/focused.out" >/dev/null
grep -F 'limit 3, vitest=1' "$SANDBOX/focused.out" >/dev/null
grep -F "$SANDBOX/ticket/vite|exec vitest run src/example.test.tsx|VITEST_MAX_WORKERS=1" "$SANDBOX/npm.log" >/dev/null

: > "$SANDBOX/npm.log"
run_gate --check \
  --test server:src/example.test.ts \
  --test vite:src/example.test.tsx \
  --test integration:src/example.integration.test.ts \
  --test shell:checks/example.test.sh >"$SANDBOX/check.out"
grep -F 'class check' "$SANDBOX/check.out" >/dev/null
grep -F 'limit 3, vitest=2' "$SANDBOX/check.out" >/dev/null
grep -F "$SANDBOX/ticket|run typecheck|VITEST_MAX_WORKERS=2" "$SANDBOX/npm.log" >/dev/null
grep -F "$SANDBOX/ticket|run lint|VITEST_MAX_WORKERS=2" "$SANDBOX/npm.log" >/dev/null
grep -F "$SANDBOX/ticket/server|exec vitest run src/example.test.ts|VITEST_MAX_WORKERS=2" "$SANDBOX/npm.log" >/dev/null
grep -F "$SANDBOX/ticket/vite|exec vitest run src/example.test.tsx|VITEST_MAX_WORKERS=2" "$SANDBOX/npm.log" >/dev/null
grep -F "$SANDBOX/ticket/server|exec -- vitest run --config vitest.integration.config.ts src/example.integration.test.ts|VITEST_MAX_WORKERS=2" "$SANDBOX/npm.log" >/dev/null
grep -F 'shell check ran' "$SANDBOX/npm.log" >/dev/null
if grep -E '\|run (test|verify|test:server|test:web|test:integration)\|' "$SANDBOX/npm.log" >/dev/null; then
  echo 'a named check ran a broad suite' >&2
  exit 1
fi

# Three whole check jobs may run. A fourth waits until one finishes.
wait_for_slot() {
  local output="$1" attempt
  for attempt in $(seq 1 50); do
    grep -F 'class check, slot' "$output" >/dev/null 2>&1 && return 0
    sleep 0.1
  done
  echo "check did not acquire a slot: $output" >&2
  return 1
}

concurrent_env=("${gate_env[@]}" MC_FAKE_SLEEP=3)
for name in one two three; do
  (cd "$SANDBOX/ticket" && env "${concurrent_env[@]}" "$GATE" --check >"$SANDBOX/$name.out" 2>&1) &
  eval "$name=$!"
done
for name in one two three; do wait_for_slot "$SANDBOX/$name.out"; done
(cd "$SANDBOX/ticket" && env "${concurrent_env[@]}" "$GATE" --check >"$SANDBOX/four.out" 2>&1) &
four=$!
sleep 0.3
grep -F 'check lane is at capacity — queued' "$SANDBOX/four.out" >/dev/null
wait "$one" "$two" "$three" "$four"

echo 'mc-gate simple scheduler: PASS'
