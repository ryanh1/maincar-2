#!/usr/bin/env bash
# Guards the hook rule that another workspace's red test suite does not block
# this commit. The test exercises the real hook in a tiny Git repository, with
# faked Node and npm commands so it has no database or package dependency.
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

cat > "$SANDBOX/bin/node" <<'SH'
#!/usr/bin/env bash
# The hook's database reachability check passes in this isolated hook test.
exit 0
SH
cat > "$SANDBOX/bin/npm" <<'SH'
#!/usr/bin/env bash
case "$*" in
  "--prefix server run test --silent")
    printf 'server runner stopped before it printed a summary\n' >&2
    exit 1
    ;;
  *)
    exit 0
    ;;
esac
SH
chmod +x "$SANDBOX/bin/node" "$SANDBOX/bin/npm"

run_hook() {
  (
    cd "$REPO"
    MC_MAIN_CHECKOUT="$SANDBOX/primary" PATH="$SANDBOX/bin:$PATH" \
      /bin/bash .githooks/pre-commit
  )
}

# Prove the guard fails against the old hook. The foreign server test exits 1,
# but it prints no recognised summary. Under `pipefail`, the former grep then
# aborts the hook before it can write the permitted degraded verdict.
cp "$REPO/.githooks/pre-commit" "$SANDBOX/pre-commit.fixed"
old_summary='grep -E "FAIL|Tests " "$TMP/out" | sed '\''s/^/      /'\'' | head -6'
perl -0pi -e "s!test_failure_summary \"\\\$TMP/out\" \"      \" 6!$old_summary!" \
  "$REPO/.githooks/pre-commit"
if run_hook > "$SANDBOX/old.out" 2>&1; then
  fail 'the old hook accepted a foreign test failure without a summary'
fi

# Restore the tested hook. It must record a degraded verdict and allow the
# inert docs-only commit to continue.
cp "$SANDBOX/pre-commit.fixed" "$REPO/.githooks/pre-commit"
run_hook > "$SANDBOX/fixed.out" 2>&1 ||
  fail 'the fixed hook blocked a foreign test failure without a summary'
[ "$(cat "$REPO/.git/VERIFY_STATUS")" = 'degraded: server tests' ] ||
  fail 'the fixed hook did not record the foreign test failure'
grep -Fq '(no recognized test failure summary was emitted)' "$SANDBOX/fixed.out" ||
  fail 'the fixed hook did not explain the absent test summary'

# A test failure inside the staged workspace must still block the commit and
# show the hook's intentional failure message.
touch "$REPO/server-change.ts"
git -C "$REPO" add server-change.ts
if run_hook > "$SANDBOX/ours.out" 2>&1; then
  fail 'the fixed hook accepted a test failure that this commit could cause'
fi
grep -Fq 'COMMIT BLOCKED — server tests failed' "$SANDBOX/ours.out" ||
  fail 'the fixed hook did not report an attributable test failure'

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
MC_MAIN_CHECKOUT="$SANDBOX/primary" PATH="$SANDBOX/bin:$PATH" \
  git -C "$REBASE_REPO" commit -m 'Base commit' --quiet
git -C "$REBASE_REPO" checkout -b topic --quiet
touch "$REBASE_REPO/topic.md"
git -C "$REBASE_REPO" add topic.md
MC_MAIN_CHECKOUT="$SANDBOX/primary" PATH="$SANDBOX/bin:$PATH" \
  git -C "$REBASE_REPO" commit -m 'Topic commit' --quiet
git -C "$REBASE_REPO" checkout main --quiet
touch "$REBASE_REPO/main.md"
git -C "$REBASE_REPO" add main.md
MC_MAIN_CHECKOUT="$SANDBOX/primary" PATH="$SANDBOX/bin:$PATH" \
  git -C "$REBASE_REPO" commit -m 'Main commit' --quiet
git -C "$REBASE_REPO" checkout topic --quiet
MC_MAIN_CHECKOUT="$SANDBOX/primary" PATH="$SANDBOX/bin:$PATH" \
  git -C "$REBASE_REPO" rebase main --quiet
topic_message="$(git -C "$REBASE_REPO" log -1 --format=%B)"
case "$topic_message" in
  *'Verified-by: NOTHING'*)
    fail 'rebase marked a previously verified commit as unverified'
    ;;
esac
[ "$(printf '%s\n' "$topic_message" | grep -c '^Verified-by:')" -eq 1 ] ||
  fail 'rebase changed the original verification receipt'

printf 'pre-commit guard: passed\n'
