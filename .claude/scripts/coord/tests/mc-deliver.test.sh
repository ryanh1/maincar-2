#!/usr/bin/env bash
# End-to-end regression coverage for single-issue focused delivery.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
DELIVER="$ROOT/.claude/scripts/coord/mc-deliver"
SANDBOX="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/mc-deliver-test-XXXXXX")" && pwd -P)"
trap 'rm -rf "$SANDBOX"' EXIT

mkdir -p "$SANDBOX/bin" "$SANDBOX/primary/server/src"
cat > "$SANDBOX/bin/npm" <<'EOF'
#!/usr/bin/env bash
printf '%s|%s|VITEST_MAX_WORKERS=%s\n' "$PWD" "$*" "${VITEST_MAX_WORKERS:-}" >> "$MC_FAKE_NPM_LOG"
if [ "${MC_FAKE_FAIL_TEST:-0}" = 1 ] && [[ "$*" = 'exec vitest run '* ]]; then exit 9; fi
exit 0
EOF
chmod +x "$SANDBOX/bin/npm"

git init --bare "$SANDBOX/upstream.git" --quiet
git init "$SANDBOX/primary" --quiet
git -C "$SANDBOX/primary" config user.name 'Delivery test'
git -C "$SANDBOX/primary" config user.email 'delivery-test@example.test'
git -C "$SANDBOX/primary" checkout -b main --quiet
printf '%s\n' '{"name":"delivery-fixture"}' > "$SANDBOX/primary/package.json"
printf '%s\n' 'base' > "$SANDBOX/primary/server/src/example.test.ts"
git -C "$SANDBOX/primary" add .
git -C "$SANDBOX/primary" commit -m 'Initial main' --quiet
git -C "$SANDBOX/primary" remote add origin "$SANDBOX/upstream.git"
git -C "$SANDBOX/primary" push origin main --quiet

primary_real="$(cd "$SANDBOX/primary" && pwd -P)"
deliver_env=(
  MC_STATE_HOME="$SANDBOX/state"
  MC_MAIN_CHECKOUT="$primary_real"
  MC_LOCAL_MAIN_REPO="$SANDBOX/state/local-main.git"
  MC_FAKE_NPM_LOG="$SANDBOX/npm.log"
  PATH="$SANDBOX/bin:$PATH"
)
(cd "$SANDBOX/primary" && env "${deliver_env[@]}" "$ROOT/.claude/scripts/coord/mc-local-main" sync)

make_ticket() {
  local path="$1" branch="$2" file="$3" content="$4"
  git clone "$SANDBOX/state/local-main.git" "$path" --quiet
  git -C "$path" config user.name 'Delivery test'
  git -C "$path" config user.email 'delivery-test@example.test'
  git -C "$path" checkout -b "$branch" --quiet
  mkdir -p "$(dirname "$path/$file")"
  printf '%s\n' "$content" > "$path/$file"
  git -C "$path" add "$file"
  git -C "$path" commit -m "$branch" --quiet
}
enqueue() {
  local path="$1"; shift
  (cd "$path" && env "${deliver_env[@]}" "$DELIVER" enqueue "$@")
}
run_delivery() {
  local path="$1"; shift
  (cd "$path" && env "${deliver_env[@]}" "$@" "$DELIVER" run)
}

make_ticket "$SANDBOX/mai-101" mai-101-first server/src/first.ts 'first change'
make_ticket "$SANDBOX/mai-102" mai-102-second server/src/second.ts 'second change'
enqueue "$SANDBOX/mai-101" --test server:src/example.test.ts
enqueue "$SANDBOX/mai-102" --test server:src/example.test.ts
test "$(env "${deliver_env[@]}" "$DELIVER" status --count)" -eq 2

: > "$SANDBOX/npm.log"
run_delivery "$SANDBOX/mai-101" > "$SANDBOX/first.out"
git -C "$SANDBOX/upstream.git" cat-file -e main:server/src/first.ts
if git -C "$SANDBOX/upstream.git" cat-file -e main:server/src/second.ts 2>/dev/null; then
  echo 'one delivery run combined two issues' >&2
  exit 1
fi
test "$(env "${deliver_env[@]}" "$DELIVER" status --count)" -eq 1
grep -F '|run typecheck|VITEST_MAX_WORKERS=2' "$SANDBOX/npm.log" >/dev/null
grep -F '|run lint|VITEST_MAX_WORKERS=2' "$SANDBOX/npm.log" >/dev/null
grep -F '/server|exec vitest run src/example.test.ts|VITEST_MAX_WORKERS=2' "$SANDBOX/npm.log" >/dev/null
if grep -E '\|run (test|verify|test:server|test:web|test:integration)\|' "$SANDBOX/npm.log" >/dev/null; then
  echo 'delivery ran a broad suite' >&2
  exit 1
fi
test -f "$SANDBOX/state/state/deliveries/MAI-101.tsv"
test ! -d "$SANDBOX/state/state/deliver/runs"

# A failed issue is returned without retries. The next queued issue remains available.
second_base="$(git -C "$SANDBOX/upstream.git" rev-parse main)"
: > "$SANDBOX/npm.log"
if run_delivery "$SANDBOX/mai-102" MC_FAKE_FAIL_TEST=1 > "$SANDBOX/failed.out" 2>&1; then
  echo 'delivery accepted a failed named test' >&2
  exit 1
fi
test "$(git -C "$SANDBOX/upstream.git" rev-parse main)" = "$second_base"
test "$(grep -c 'exec vitest run src/example.test.ts' "$SANDBOX/npm.log")" -eq 1
grep -rlF 'MAI-102' "$SANDBOX/state/state/deliver/failed" >/dev/null
test "$(env "${deliver_env[@]}" "$DELIVER" status --count)" -eq 0

make_ticket "$SANDBOX/mai-103" mai-103-third server/src/third.ts 'third change'
enqueue "$SANDBOX/mai-103" --test server:src/example.test.ts
run_delivery "$SANDBOX/mai-103" > "$SANDBOX/third.out"
git -C "$SANDBOX/upstream.git" cat-file -e main:server/src/third.ts

if (cd "$SANDBOX/mai-103" && env "${deliver_env[@]}" "$ROOT/.claude/scripts/coord/mc-train" status > "$SANDBOX/train.out" 2>&1); then
  echo 'retired train still accepted work' >&2
  exit 1
fi
grep -F 'replaced by mc-deliver' "$SANDBOX/train.out" >/dev/null

echo 'mc-deliver single-issue delivery: PASS'
