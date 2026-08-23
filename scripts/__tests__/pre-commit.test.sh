#!/usr/bin/env bash
# Proves that the commit hook uses the shared static-check gate and blocks red.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SANDBOX="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/maincar-pre-commit-test-XXXXXX")" && pwd -P)"
trap 'rm -rf "$SANDBOX"' EXIT
REPO="$SANDBOX/repo"

fail() { printf 'pre-commit guard: %s\n' "$*" >&2; exit 1; }

git init "$REPO" --quiet
git -C "$REPO" config user.name 'Hook test'
git -C "$REPO" config user.email 'hook-test@example.test'
mkdir -p "$REPO/.githooks" "$REPO/.claude/scripts/coord" "$SANDBOX/primary"
cp "$ROOT/.githooks/pre-commit" "$REPO/.githooks/pre-commit"
cat > "$REPO/.claude/scripts/coord/mc-gate" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$MC_HOOK_GATE_LOG"
[ "${MC_HOOK_GATE_FAIL:-0}" -eq 0 ]
SH
chmod +x "$REPO/.claude/scripts/coord/mc-gate"

run_hook() {
  (cd "$REPO" && MC_MAIN_CHECKOUT="$SANDBOX/primary" \
    MC_HOOK_GATE_LOG="$SANDBOX/gate.log" /bin/bash .githooks/pre-commit)
}

run_hook > "$SANDBOX/hook.out" 2>&1 || fail 'the hook blocked a green static check'
[ "$(cat "$REPO/.git/VERIFY_STATUS")" = green ] || fail 'the hook did not record green'
[ "$(cat "$SANDBOX/gate.log")" = --static ] || fail 'the hook did not use mc-gate --static'

if MC_HOOK_GATE_FAIL=1 run_hook > "$SANDBOX/red.out" 2>&1; then
  fail 'the hook accepted a red static check'
fi

if (cd "$SANDBOX/primary" && MC_MAIN_CHECKOUT="$SANDBOX/primary" /bin/bash "$REPO/.githooks/pre-commit") > "$SANDBOX/primary.out" 2>&1; then
  fail 'the hook allowed a commit from the primary checkout'
fi
grep -Fq 'COMMIT BLOCKED' "$SANDBOX/primary.out" || fail 'the primary-checkout block was unclear'

printf 'pre-commit guard: passed\n'
