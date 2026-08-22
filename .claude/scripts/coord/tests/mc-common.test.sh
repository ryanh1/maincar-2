#!/usr/bin/env bash
# Regression coverage for coordination helpers. Run from any checkout:
#   ./.claude/scripts/coord/tests/mc-common.test.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/mc-common-test-XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT

git init --bare "$SANDBOX/upstream.git" --quiet
git init "$SANDBOX/delivery" --quiet
git -C "$SANDBOX/delivery" config user.name 'Coordination test'
git -C "$SANDBOX/delivery" config user.email 'coordination-test@example.test'
git -C "$SANDBOX/delivery" checkout -b main --quiet
git -C "$SANDBOX/delivery" commit --allow-empty -m 'Initial main' --quiet
git -C "$SANDBOX/delivery" remote add origin "$SANDBOX/upstream.git"
git -C "$SANDBOX/delivery" push origin main --quiet

# This matches the supported worktree setup: clone the local delivery checkout.
git clone "$SANDBOX/delivery" "$SANDBOX/issue-worktree" --quiet

# Advance only the canonical remote. The local delivery checkout is deliberately
# stale, so a fetch through the helper must not read its checked-out main.
git clone "$SANDBOX/upstream.git" "$SANDBOX/publisher" --quiet
git -C "$SANDBOX/publisher" config user.name 'Coordination test'
git -C "$SANDBOX/publisher" config user.email 'coordination-test@example.test'
git -C "$SANDBOX/publisher" commit --allow-empty -m 'Canonical update' --quiet
git -C "$SANDBOX/publisher" push origin main --quiet

upstream="$({
  cd "$SANDBOX/issue-worktree"
  # shellcheck source=../mc-common.sh
  source "$ROOT/.claude/scripts/coord/mc-common.sh"
  mc_upstream_url
})"

if [ "$upstream" != "$SANDBOX/upstream.git" ]; then
  echo "expected canonical upstream $SANDBOX/upstream.git, got $upstream" >&2
  exit 1
fi

({
  cd "$SANDBOX/issue-worktree"
  # shellcheck source=../mc-common.sh
  source "$ROOT/.claude/scripts/coord/mc-common.sh"
  mc_fetch_upstream_main --quiet
})

if [ "$(git -C "$SANDBOX/issue-worktree" rev-parse refs/remotes/origin/main)" != "$(git -C "$SANDBOX/upstream.git" rev-parse main)" ]; then
  echo 'canonical fetch did not update origin/main' >&2
  exit 1
fi

git -C "$SANDBOX/issue-worktree" config user.name 'Coordination test'
git -C "$SANDBOX/issue-worktree" config user.email 'coordination-test@example.test'
git -C "$SANDBOX/issue-worktree" rebase origin/main --quiet
git -C "$SANDBOX/issue-worktree" checkout -b issue-change --quiet
git -C "$SANDBOX/issue-worktree" commit --allow-empty -m 'Issue change' --quiet
touch "$SANDBOX/delivery/unrelated-wip"

# A regular merge must push to the canonical remote even while its local source
# checkout has unrelated WIP. The old helper pushed to delivery and was rejected.
(
  cd "$SANDBOX/issue-worktree"
  MC_STATE_HOME="$SANDBOX/state" "$ROOT/.claude/scripts/coord/mc-merge" -m 'Merge issue change'
)

if ! git -C "$SANDBOX/upstream.git" merge-base --is-ancestor "$(git -C "$SANDBOX/issue-worktree" rev-parse HEAD)" main; then
  echo 'merge did not reach the canonical upstream' >&2
  exit 1
fi

echo 'mc-common upstream resolution: PASS'
