#!/usr/bin/env bash
# Regression coverage for the local, bare main mirror. Run from any checkout:
#   ./.claude/scripts/coord/tests/mc-common.test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"

# Three two-worker jobs use no more than six Vitest workers. Focused tests use
# one worker, and the gate never invokes Playwright.
if ! grep -Fx 'JOB_LIMIT=3' "$ROOT/.claude/scripts/coord/mc-gate" >/dev/null || \
   ! grep -F 'VITEST_WORKERS=2' "$ROOT/.claude/scripts/coord/mc-gate" >/dev/null || \
   ! grep -F 'VITEST_WORKERS=1' "$ROOT/.claude/scripts/coord/mc-gate" >/dev/null || \
   grep -F 'playwright' "$ROOT/.claude/scripts/coord/mc-gate" >/dev/null; then
  echo 'mc-gate does not preserve the three-job, six-worker ceiling' >&2
  exit 1
fi

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/mc-common-test-XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT

git init --bare "$SANDBOX/upstream.git" --quiet
git init "$SANDBOX/primary" --quiet
git -C "$SANDBOX/primary" config user.name 'Coordination test'
git -C "$SANDBOX/primary" config user.email 'coordination-test@example.test'
git -C "$SANDBOX/primary" checkout -b main --quiet
touch "$SANDBOX/primary/tracked-placeholder"
git -C "$SANDBOX/primary" add tracked-placeholder
git -C "$SANDBOX/primary" commit --allow-empty -m 'Initial main' --quiet
git -C "$SANDBOX/primary" remote add origin "$SANDBOX/upstream.git"
git -C "$SANDBOX/primary" push origin main --quiet

env_for_test=(
  MC_STATE_HOME="$SANDBOX/state"
  MC_MAIN_CHECKOUT="$SANDBOX/primary"
  MC_LOCAL_MAIN_REPO="$SANDBOX/state/local-main.git"
)
LEGACY_MERGE="$ROOT/.claude/scripts/coord/tests/fixtures/mc-merge-legacy"

# The real delivery gate writes this record after its named checks. These
# mirror tests exercise merge mechanics with no application test runtime, so
# record the same immutable head/base/branch evidence directly.
record_delivery_gate() {
  local checkout="$1"
  (
    cd "$checkout"
    env "${env_for_test[@]}" bash -c '
      source "$1/.claude/scripts/coord/mc-common.sh"
      mc_record_delivery_gate "$(git rev-parse HEAD)" "$(git rev-parse origin/main)" "$(mc_branch)"
    ' _ "$ROOT"
  )
}

# A process can die after mkdir succeeds but before it records its PID. The
# shared lock helper must recover that empty directory instead of timing out.
mkdir -p "$SANDBOX/state/state/locks/empty-owner.lock"
sleep 1
env "${env_for_test[@]}" bash -c 'source "$1/.claude/scripts/coord/mc-common.sh"; mc_lock_acquire "$MC_STATE_HOME/state/locks/empty-owner.lock" 2; mc_lock_release "$MC_STATE_HOME/state/locks/empty-owner.lock"' _ "$ROOT"

(
  cd "$SANDBOX/primary"
  env "${env_for_test[@]}" "$ROOT/.claude/scripts/coord/mc-local-main" sync
)

test "$(git -C "$SANDBOX/state/local-main.git" rev-parse --is-bare-repository)" = true
test "$(git -C "$SANDBOX/state/local-main.git" rev-parse main)" = "$(git -C "$SANDBOX/upstream.git" rev-parse main)"
test "$(git -C "$SANDBOX/state/local-main.git" remote get-url upstream)" = "$SANDBOX/upstream.git"
if [ "$(git -C "$SANDBOX/primary" config --worktree --get core.hooksPath)" != "$SANDBOX/state/primary-hooks" ]; then
  echo 'primary checkout was not configured with the hard-block hooks' >&2
  exit 1
fi
touch "$SANDBOX/primary/blocked-commit"
git -C "$SANDBOX/primary" add blocked-commit
if git -C "$SANDBOX/primary" commit -m 'Must not commit in primary' --quiet; then
  echo 'the primary checkout accepted a commit' >&2
  exit 1
fi
git -C "$SANDBOX/primary" reset --hard HEAD --quiet

# A ticket cloned from the old primary checkout must migrate to the bare local
# mirror before it fetches or merges.
git clone "$SANDBOX/primary" "$SANDBOX/issue-worktree" --quiet
git -C "$SANDBOX/issue-worktree" config user.name 'Coordination test'
git -C "$SANDBOX/issue-worktree" config user.email 'coordination-test@example.test'
git -C "$SANDBOX/issue-worktree" checkout -b issue-change --quiet
git -C "$SANDBOX/issue-worktree" commit --allow-empty -m 'Issue change' --quiet
record_delivery_gate "$SANDBOX/issue-worktree"

(
  cd "$SANDBOX/issue-worktree"
  env "${env_for_test[@]}" "$LEGACY_MERGE" -m 'Merge issue change'
)

if [ "$(git -C "$SANDBOX/issue-worktree" remote get-url origin)" != "$SANDBOX/state/local-main.git" ]; then
  echo 'ticket checkout did not migrate to the local bare mirror' >&2
  exit 1
fi

if ! git -C "$SANDBOX/upstream.git" merge-base --is-ancestor "$(git -C "$SANDBOX/issue-worktree" rev-parse HEAD)" main; then
  echo 'merge did not reach the canonical upstream' >&2
  exit 1
fi
if [ "$(git -C "$SANDBOX/primary" rev-parse HEAD)" != "$(git -C "$SANDBOX/upstream.git" rev-parse main)" ]; then
  echo 'primary checkout did not refresh after a clean delivery' >&2
  exit 1
fi

# A fresh ref would be accepted by a normal bare repository. The mirror's
# receive hook must refuse it, which makes a raw `git push origin` non-delivery.
git -C "$SANDBOX/issue-worktree" commit --allow-empty -m 'Direct push attempt' --quiet
if git -C "$SANDBOX/issue-worktree" push origin HEAD:direct-push-test; then
  echo 'the local bare mirror accepted a direct ticket push' >&2
  exit 1
fi

if [ "$(git -C "$SANDBOX/state/local-main.git" rev-parse main)" != "$(git -C "$SANDBOX/upstream.git" rev-parse main)" ]; then
  echo 'local bare mirror did not refresh after the merge' >&2
  exit 1
fi
if [ "$(git -C "$SANDBOX/issue-worktree" rev-parse origin/main)" != "$(git -C "$SANDBOX/state/local-main.git" rev-parse main)" ]; then
  echo 'ticket origin/main did not refresh after the merge' >&2
  exit 1
fi

# A locally deleted tracked file still counts as personal work. Clear the
# intentional deletion before testing the clean automatic refresh path.
rm -f "$SANDBOX/primary/tracked-placeholder"
git -C "$SANDBOX/primary" checkout -- tracked-placeholder
git clone "$SANDBOX/state/local-main.git" "$SANDBOX/issue-primary-refresh" --quiet
git -C "$SANDBOX/issue-primary-refresh" config user.name 'Coordination test'
git -C "$SANDBOX/issue-primary-refresh" config user.email 'coordination-test@example.test'
git -C "$SANDBOX/issue-primary-refresh" checkout -b issue-primary-refresh --quiet
touch "$SANDBOX/issue-primary-refresh/delivered-change"
git -C "$SANDBOX/issue-primary-refresh" add delivered-change
git -C "$SANDBOX/issue-primary-refresh" rm tracked-placeholder --quiet
git -C "$SANDBOX/issue-primary-refresh" commit -m 'Refresh primary checkout' --quiet
record_delivery_gate "$SANDBOX/issue-primary-refresh"
(
  cd "$SANDBOX/issue-primary-refresh"
  env "${env_for_test[@]}" "$LEGACY_MERGE" -m 'Refresh primary checkout'
)
if [ "$(git -C "$SANDBOX/primary" rev-parse HEAD)" != "$(git -C "$SANDBOX/upstream.git" rev-parse main)" ]; then
  echo 'clean primary checkout did not fast-forward after delivery' >&2
  exit 1
fi
if [ -e "$SANDBOX/primary/tracked-placeholder" ]; then
  echo 'primary checkout retained a file removed by delivered main' >&2
  exit 1
fi
if [ ! -e "$SANDBOX/primary/delivered-change" ]; then
  echo 'primary checkout did not receive a delivered file' >&2
  exit 1
fi

# An untracked path that would be created by delivered main is not safe to
# retain. It must block the refresh, leave an actionable receipt, and make the
# coordination health check fail loudly rather than silently accumulating drift.
printf '%s\n' 'local draft' > "$SANDBOX/primary/untracked-collision"
git clone "$SANDBOX/state/local-main.git" "$SANDBOX/issue-untracked-collision" --quiet
git -C "$SANDBOX/issue-untracked-collision" config user.name 'Coordination test'
git -C "$SANDBOX/issue-untracked-collision" config user.email 'coordination-test@example.test'
git -C "$SANDBOX/issue-untracked-collision" checkout -b issue-untracked-collision --quiet
printf '%s\n' 'delivered source' > "$SANDBOX/issue-untracked-collision/untracked-collision"
git -C "$SANDBOX/issue-untracked-collision" add untracked-collision
git -C "$SANDBOX/issue-untracked-collision" commit -m 'Deliver colliding path' --quiet
record_delivery_gate "$SANDBOX/issue-untracked-collision"
primary_before_collision_delivery="$(git -C "$SANDBOX/primary" rev-parse HEAD)"
(
  cd "$SANDBOX/issue-untracked-collision"
  env "${env_for_test[@]}" "$LEGACY_MERGE" -m 'Deliver colliding untracked path'
)
if [ "$(git -C "$SANDBOX/primary" rev-parse HEAD)" != "$primary_before_collision_delivery" ]; then
  echo 'primary checkout refreshed across a colliding untracked path' >&2
  exit 1
fi
if [ ! -f "$SANDBOX/state/state/primary-refresh-pending.tsv" ]; then
  echo 'blocked primary refresh did not leave a durable pending receipt' >&2
  exit 1
fi
if (
  cd "$SANDBOX/primary"
  MC_TICKET_ROOT="$SANDBOX/empty-ticket-root" env "${env_for_test[@]}" "$ROOT/.claude/scripts/coord/mc-doctor" > "$SANDBOX/doctor.out" 2>&1
); then
  echo 'mc-doctor accepted a stale primary checkout' >&2
  exit 1
fi
if ! grep -F 'REFRESH REQUIRED' "$SANDBOX/doctor.out" >/dev/null; then
  echo 'mc-doctor did not explain the blocked primary refresh' >&2
  exit 1
fi
if ! grep -F 'Next: npm run mirror-to-main' "$SANDBOX/doctor.out" >/dev/null; then
  echo 'mc-doctor did not record the exact primary refresh command' >&2
  exit 1
fi
rm -f "$SANDBOX/primary/untracked-collision"
env "${env_for_test[@]}" "$ROOT/.claude/scripts/coord/mc-local-main" refresh
if [ -f "$SANDBOX/state/state/primary-refresh-pending.tsv" ]; then
  echo 'successful primary refresh did not clear the pending receipt' >&2
  exit 1
fi

# A running local app does not block a source-only fast-forward. It may reload
# or keep its already-loaded code, but local main must still become current.
git clone "$SANDBOX/state/local-main.git" "$SANDBOX/issue-active-process" --quiet
git -C "$SANDBOX/issue-active-process" config user.name 'Coordination test'
git -C "$SANDBOX/issue-active-process" config user.email 'coordination-test@example.test'
git -C "$SANDBOX/issue-active-process" checkout -b issue-active-process --quiet
touch "$SANDBOX/issue-active-process/active-process-change"
git -C "$SANDBOX/issue-active-process" add active-process-change
git -C "$SANDBOX/issue-active-process" commit -m 'Deliver while local app runs' --quiet
record_delivery_gate "$SANDBOX/issue-active-process"
(
  cd "$SANDBOX/issue-active-process"
  MC_PRIMARY_ACTIVE_PROCESS_PIDS=4242 env "${env_for_test[@]}" "$LEGACY_MERGE" -m 'Deliver while local app runs'
)
if [ "$(git -C "$SANDBOX/primary" rev-parse HEAD)" != "$(git -C "$SANDBOX/upstream.git" rev-parse main)" ]; then
  echo 'active process incorrectly blocked a source-only primary refresh' >&2
  exit 1
fi
test -e "$SANDBOX/primary/active-process-change"
test ! -f "$SANDBOX/state/state/primary-refresh-pending.tsv"

# A dependency manifest or lockfile changes the runnable environment, not just
# tracked source. The automatic refresh must leave the primary on its known-good
# revision until its dependencies have been synchronized deliberately.
primary_before_dependency_delivery="$(git -C "$SANDBOX/primary" rev-parse HEAD)"
git clone "$SANDBOX/state/local-main.git" "$SANDBOX/issue-dependency-refresh" --quiet
git -C "$SANDBOX/issue-dependency-refresh" config user.name 'Coordination test'
git -C "$SANDBOX/issue-dependency-refresh" config user.email 'coordination-test@example.test'
git -C "$SANDBOX/issue-dependency-refresh" checkout -b issue-dependency-refresh --quiet
mkdir -p "$SANDBOX/issue-dependency-refresh/vite"
printf '{"lockfileVersion": 3}\n' > "$SANDBOX/issue-dependency-refresh/vite/package-lock.json"
git -C "$SANDBOX/issue-dependency-refresh" add vite/package-lock.json
git -C "$SANDBOX/issue-dependency-refresh" commit -m 'Change frontend dependency lockfile' --quiet
record_delivery_gate "$SANDBOX/issue-dependency-refresh"
(
  cd "$SANDBOX/issue-dependency-refresh"
  env "${env_for_test[@]}" "$LEGACY_MERGE" -m 'Deliver dependency lockfile change'
)
if [ "$(git -C "$SANDBOX/primary" rev-parse HEAD)" != "$primary_before_dependency_delivery" ]; then
  echo 'primary checkout refreshed source across an unsynchronized dependency lockfile change' >&2
  exit 1
fi

# A refresh while an app is running still advances Git, but defers `npm ci`.
# Stub npm so the test proves it did not run prematurely.
mkdir -p "$SANDBOX/fake-bin"
cat > "$SANDBOX/fake-bin/npm" <<'EOF'
#!/usr/bin/env bash
[ -z "${MC_NPM_LOG:-}" ] || printf '%s|%s\n' "$PWD" "$*" >> "$MC_NPM_LOG"
EOF
chmod +x "$SANDBOX/fake-bin/npm"
MC_PRIMARY_ACTIVE_PROCESS_PIDS=4242 MC_NPM_LOG="$SANDBOX/npm.log" PATH="$SANDBOX/fake-bin:$PATH" env "${env_for_test[@]}" "$ROOT/.claude/scripts/coord/mc-local-main" refresh
if [ "$(git -C "$SANDBOX/primary" rev-parse HEAD)" != "$(git -C "$SANDBOX/upstream.git" rev-parse main)" ]; then
  echo 'active process incorrectly blocked a dependency-source fast-forward' >&2
  exit 1
fi
primary_real="$(cd "$SANDBOX/primary" && pwd -P)"
if [ -s "$SANDBOX/npm.log" ]; then
  echo 'dependency installation ran while a primary process was active' >&2
  exit 1
fi
grep -F 'provisioning deferred (roots=vite; prisma=0; active=4242)' "$SANDBOX/state/state/primary-refresh-pending.tsv" >/dev/null

# Once the process stops, pending environment work runs without moving Git
# again, and the pending marker is cleared.
MC_NPM_LOG="$SANDBOX/npm.log" PATH="$SANDBOX/fake-bin:$PATH" env "${env_for_test[@]}" "$ROOT/.claude/scripts/coord/mc-local-main" refresh
if ! grep -Fx -- "$primary_real/vite|ci" "$SANDBOX/npm.log" >/dev/null; then
  echo 'stopped process did not release the deferred dependency installation' >&2
  exit 1
fi
test ! -f "$SANDBOX/state/state/primary-refresh-pending.tsv"

# A receipt is bound to both the ticket head and the main tip. Once another
# ticket advances main, mc-merge must reject the stale receipt rather than
# rebasing or running verification while it owns the merge lock.
git clone "$SANDBOX/state/local-main.git" "$SANDBOX/issue-rebase-dependency" --quiet
git -C "$SANDBOX/issue-rebase-dependency" config user.name 'Coordination test'
git -C "$SANDBOX/issue-rebase-dependency" config user.email 'coordination-test@example.test'
git -C "$SANDBOX/issue-rebase-dependency" checkout -b issue-rebase-dependency --quiet
touch "$SANDBOX/issue-rebase-dependency/ticket-change"
git -C "$SANDBOX/issue-rebase-dependency" add ticket-change
git -C "$SANDBOX/issue-rebase-dependency" commit -m 'Ticket change before dependency update' --quiet

git clone "$SANDBOX/state/local-main.git" "$SANDBOX/main-add-firebase-dependency" --quiet
git -C "$SANDBOX/main-add-firebase-dependency" config user.name 'Coordination test'
git -C "$SANDBOX/main-add-firebase-dependency" config user.email 'coordination-test@example.test'
git -C "$SANDBOX/main-add-firebase-dependency" checkout -b main-add-firebase-dependency --quiet
mkdir -p "$SANDBOX/main-add-firebase-dependency/firebase"
printf '{"lockfileVersion": 3}\n' > "$SANDBOX/main-add-firebase-dependency/firebase/package-lock.json"
git -C "$SANDBOX/main-add-firebase-dependency" add firebase/package-lock.json
git -C "$SANDBOX/main-add-firebase-dependency" commit -m 'Add Firebase dependency lockfile' --quiet
record_delivery_gate "$SANDBOX/main-add-firebase-dependency"
(
  cd "$SANDBOX/main-add-firebase-dependency"
  env "${env_for_test[@]}" "$LEGACY_MERGE" -m 'Deliver Firebase dependency lockfile'
)

record_delivery_gate "$SANDBOX/issue-rebase-dependency"
if (
  cd "$SANDBOX/issue-rebase-dependency"
  env "${env_for_test[@]}" "$LEGACY_MERGE" --gate -m 'Reject stale ticket receipt'
); then
  echo 'mc-merge accepted a receipt from before main advanced' >&2
  exit 1
fi
git -C "$SANDBOX/issue-rebase-dependency" fetch origin --quiet
git -C "$SANDBOX/issue-rebase-dependency" rebase origin/main --quiet
record_delivery_gate "$SANDBOX/issue-rebase-dependency"
(
  cd "$SANDBOX/issue-rebase-dependency"
  env "${env_for_test[@]}" "$LEGACY_MERGE" -m 'Merge ticket after fresh delivery gate'
)

# Schema migrations are the database equivalent of a dependency lockfile: code
# cannot safely run until they are applied. Automatic refresh must therefore
# hold the primary at its known-good revision until an explicit refresh applies
# the tracked migration.
primary_before_migration_delivery="$(git -C "$SANDBOX/primary" rev-parse HEAD)"
git clone "$SANDBOX/state/local-main.git" "$SANDBOX/issue-migration-refresh" --quiet
git -C "$SANDBOX/issue-migration-refresh" config user.name 'Coordination test'
git -C "$SANDBOX/issue-migration-refresh" config user.email 'coordination-test@example.test'
git -C "$SANDBOX/issue-migration-refresh" checkout -b issue-migration-refresh --quiet
mkdir -p "$SANDBOX/issue-migration-refresh/server/prisma/migrations/20260822090000_test_primary_refresh"
printf '%s\n' '-- test migration' > "$SANDBOX/issue-migration-refresh/server/prisma/migrations/20260822090000_test_primary_refresh/migration.sql"
git -C "$SANDBOX/issue-migration-refresh" add server/prisma/migrations
git -C "$SANDBOX/issue-migration-refresh" commit -m 'Add a schema migration' --quiet
record_delivery_gate "$SANDBOX/issue-migration-refresh"
(
  cd "$SANDBOX/issue-migration-refresh"
  env "${env_for_test[@]}" "$LEGACY_MERGE" -m 'Deliver schema migration'
)
if [ "$(git -C "$SANDBOX/primary" rev-parse HEAD)" != "$primary_before_migration_delivery" ]; then
  echo 'primary checkout refreshed source across an unapplied schema migration' >&2
  exit 1
fi

cat > "$SANDBOX/fake-bin/npx" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$MC_NPX_LOG"
EOF
chmod +x "$SANDBOX/fake-bin/npx"
MC_NPX_LOG="$SANDBOX/npx.log" PATH="$SANDBOX/fake-bin:$PATH" env "${env_for_test[@]}" "$ROOT/.claude/scripts/coord/mc-local-main" refresh
if [ "$(git -C "$SANDBOX/primary" rev-parse HEAD)" != "$(git -C "$SANDBOX/upstream.git" rev-parse main)" ]; then
  echo 'explicit primary refresh did not fast-forward the delivered schema migration' >&2
  exit 1
fi
if ! grep -Fx -- 'prisma migrate deploy' "$SANDBOX/npx.log" >/dev/null; then
  echo 'explicit primary refresh did not apply the delivered schema migration' >&2
  exit 1
fi

if env "${env_for_test[@]}" bash -c 'cd "$2"; source "$1/.claude/scripts/coord/mc-common.sh"; mc_assert_ticket_checkout' _ "$ROOT" "$SANDBOX/primary"; then
  echo 'the primary checkout was allowed to run a ticket command' >&2
  exit 1
fi

if (
  cd "$SANDBOX/primary"
  env "${env_for_test[@]}" "$ROOT/.claude/scripts/coord/mc-gate" --classify
); then
  echo 'mc-gate allowed the primary checkout to run a ticket command' >&2
  exit 1
fi

# Delivery receipts are created only after the canonical upstream accepted the
# merge. mc-closeout must then refuse Linear Done until the exact clone is gone.
git clone "$SANDBOX/state/local-main.git" "$SANDBOX/mai-999-closeout" --quiet
git -C "$SANDBOX/mai-999-closeout" config user.name 'Coordination test'
git -C "$SANDBOX/mai-999-closeout" config user.email 'coordination-test@example.test'
git -C "$SANDBOX/mai-999-closeout" checkout -b mai-999-closeout --quiet
git -C "$SANDBOX/mai-999-closeout" commit --allow-empty -m 'MAI-999: Closeout test' --quiet
record_delivery_gate "$SANDBOX/mai-999-closeout"
(
  cd "$SANDBOX/mai-999-closeout"
  env "${env_for_test[@]}" "$LEGACY_MERGE" -m 'MAI-999: Merge closeout test'
)
test -f "$SANDBOX/state/state/deliveries/MAI-999.tsv"
if env "${env_for_test[@]}" "$ROOT/.claude/scripts/coord/mc-closeout" MAI-999 --worktree "$SANDBOX/mai-999-closeout"; then
  echo 'mc-closeout allowed Linear Done before the issue clone was removed' >&2
  exit 1
fi
rm -rf "$SANDBOX/mai-999-closeout"
env "${env_for_test[@]}" "$ROOT/.claude/scripts/coord/mc-closeout" MAI-999 --worktree "$SANDBOX/mai-999-closeout" | grep -q '^LINEAR_DONE_ALLOWED MAI-999 '
test -f "$SANDBOX/state/state/linear-ready/MAI-999.tsv"

# The old merge path discarded a failed Prisma generation with `|| true`.
# This test proves the shared helper exists and propagates that failure instead.
env "${env_for_test[@]}" bash -c 'source "$1/.claude/scripts/coord/mc-common.sh"; declare -F mc_ensure_prisma_client >/dev/null' _ "$ROOT" || {
  echo 'Prisma client guard is missing' >&2
  exit 1
}
mkdir -p "$SANDBOX/prisma-client/server/prisma" "$SANDBOX/no-npm"
touch "$SANDBOX/prisma-client/server/prisma/schema.prisma"
ln -s "$(command -v false)" "$SANDBOX/no-npm/npm"
if env "${env_for_test[@]}" bash -c 'cd "$2"; PATH="$3:$PATH"; source "$1/.claude/scripts/coord/mc-common.sh"; mc_ensure_prisma_client >/dev/null 2>&1' _ "$ROOT" "$SANDBOX/prisma-client" "$SANDBOX/no-npm"; then
  echo 'Prisma client guard accepted a failed generation' >&2
  exit 1
fi

echo 'mc-common local mirror: PASS'
