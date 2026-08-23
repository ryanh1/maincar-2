#!/usr/bin/env bash
# Guards the hook boundary: it is a fast static-check backstop, never an
# unscheduled second full test gate. The test exercises the real hook in a tiny
# Git repository with a faked npm command, so it has no package dependency.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/maincar-pre-commit-test-XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT
REPO="$SANDBOX/repo"

fail() {
  printf 'pre-commit guard: %s\n' "$*" >&2
  exit 1
}

git init "$REPO" --quiet
git -C "$REPO" config user.name 'Hook test'
git -C "$REPO" config user.email 'hook-test@example.test'
mkdir -p "$REPO/docs" "$SANDBOX/bin" "$SANDBOX/primary"
cp -R "$ROOT/.githooks" "$REPO/.githooks"
touch "$REPO/docs/only-this-commit.md"
git -C "$REPO" add docs/only-this-commit.md

cat > "$SANDBOX/bin/npm" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$MC_HOOK_NPM_LOG"
case "${MC_HOOK_FAIL_TYPECHECK:-}:$*" in
  "1:--prefix server run typecheck --silent")
    printf 'server-change.ts(1,1): error TS9999: simulated failure\n' >&2
    exit 1
    ;;
  *)
    exit 0
    ;;
esac
SH
chmod +x "$SANDBOX/bin/npm"

run_hook() {
  (
    cd "$REPO"
    MC_MAIN_CHECKOUT="$SANDBOX/primary" MC_HOOK_NPM_LOG="$SANDBOX/npm.log" \
      PATH="$SANDBOX/bin:$PATH" \
      /bin/bash .githooks/pre-commit
  )
}

# Full test commands must never be called here. They belong only to
# `mc-gate --delivery`, which applies the shared delivery-lane worker budget.
run_hook > "$SANDBOX/hook.out" 2>&1 || fail 'the hook blocked a clean docs-only commit'
[ "$(cat "$REPO/.git/VERIFY_STATUS")" = 'green' ] ||
  fail 'the hook did not record a green static-check verdict'
grep -Eq -- '--prefix (server|vite) run (typecheck|lint) --silent' "$SANDBOX/npm.log" ||
  fail 'the hook did not run its static checks'
if grep -Eq -- 'run test --silent|run test:integration --silent' "$SANDBOX/npm.log"; then
  fail 'the hook invoked an unscheduled full test command'
fi

# A static-check failure in a staged source file still blocks the commit.
mkdir -p "$REPO/server"
touch "$REPO/server/server-change.ts"
git -C "$REPO" add server/server-change.ts
if MC_HOOK_FAIL_TYPECHECK=1 run_hook > "$SANDBOX/ours.out" 2>&1; then
  fail 'the hook accepted a typecheck failure in this commit'
fi
grep -Fq 'COMMIT BLOCKED — server typecheck failed' "$SANDBOX/ours.out" ||
  fail 'the hook did not report an attributable typecheck failure'

# Rebase replays a commit but does not run pre-commit. Its prepare hook must
# keep the receipt that came from the original commit, rather than append a
# false unverified trailer. This reproduces the delivery workflow exactly.
REBASE_REPO="$SANDBOX/rebase-repo"
git init "$REBASE_REPO" --quiet
git -C "$REBASE_REPO" config user.name 'Hook test'
git -C "$REBASE_REPO" config user.email 'hook-test@example.test'
git -C "$REBASE_REPO" checkout -b main --quiet
cp -R "$ROOT/.githooks" "$REBASE_REPO/.githooks"
git -C "$REBASE_REPO" config core.hooksPath .githooks
touch "$REBASE_REPO/base.md"
git -C "$REBASE_REPO" add base.md
MC_MAIN_CHECKOUT="$SANDBOX/primary" MC_HOOK_NPM_LOG="$SANDBOX/npm.log" PATH="$SANDBOX/bin:$PATH" \
  git -C "$REBASE_REPO" commit -m 'Base commit' --quiet
git -C "$REBASE_REPO" checkout -b topic --quiet
touch "$REBASE_REPO/topic.md"
git -C "$REBASE_REPO" add topic.md
MC_MAIN_CHECKOUT="$SANDBOX/primary" MC_HOOK_NPM_LOG="$SANDBOX/npm.log" PATH="$SANDBOX/bin:$PATH" \
  git -C "$REBASE_REPO" commit -m 'Topic commit' --quiet
git -C "$REBASE_REPO" checkout main --quiet
touch "$REBASE_REPO/main.md"
git -C "$REBASE_REPO" add main.md
MC_MAIN_CHECKOUT="$SANDBOX/primary" MC_HOOK_NPM_LOG="$SANDBOX/npm.log" PATH="$SANDBOX/bin:$PATH" \
  git -C "$REBASE_REPO" commit -m 'Main commit' --quiet
git -C "$REBASE_REPO" checkout topic --quiet
MC_MAIN_CHECKOUT="$SANDBOX/primary" MC_HOOK_NPM_LOG="$SANDBOX/npm.log" PATH="$SANDBOX/bin:$PATH" \
  git -C "$REBASE_REPO" rebase main --quiet
topic_message="$(git -C "$REBASE_REPO" log -1 --format=%B)"
case "$topic_message" in
  *'Verified-by: NOTHING'*)
    fail 'rebase marked a previously verified commit as unverified'
    ;;
esac
[ "$(printf '%s\n' "$topic_message" | grep -c '^Verified-by:' || true)" -eq 0 ] ||
  fail 'rebase added a false verification receipt'

printf 'pre-commit guard: passed\n'
