#!/usr/bin/env bash
# End-to-end regression coverage for the local delivery train.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
TRAIN="$ROOT/.claude/scripts/coord/mc-train"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/mc-train-test-XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT

grep -F '"gh-to-mirror"' "$ROOT/package.json" >/dev/null
grep -F '"mirror-to-main"' "$ROOT/package.json" >/dev/null

mkdir -p "$SANDBOX/bin" "$SANDBOX/primary/server/src" "$SANDBOX/primary/docs"
cat > "$SANDBOX/bin/npm" <<'EOF'
#!/usr/bin/env bash
printf '%s|%s|VITEST_MAX_WORKERS=%s\n' "$PWD" "$*" "${VITEST_MAX_WORKERS:-}" >> "$MC_FAKE_NPM_LOG"
if [ "${MC_FAKE_FAIL:-}" = primary-provision ] && [ "$(pwd -P)" = "$MC_MAIN_CHECKOUT" ] && [ "$*" = ci ] && [ ! -f "$MC_PRIMARY_FAIL_ONCE" ]; then
  touch "$MC_PRIMARY_FAIL_ONCE"
  exit 8
fi
if [ "${MC_FAKE_FAIL:-}" = dependency-prep ] && [[ "$(pwd -P)" = */mc-train-*/repo ]] && [ "$*" = ci ]; then
  exit 7
fi
if [ "${MC_FAKE_FAIL:-}" = interaction ] && [ -e server/src/feature-a.ts ] && [ -e server/src/feature-b.ts ] && [ "$*" = 'run test:server' ]; then
  exit 9
fi
if [ "$*" = 'run verify' ] && [ ! -e .env ]; then
  echo 'high-risk train did not receive the ignored local test environment' >&2
  exit 10
fi
exit 0
EOF
chmod +x "$SANDBOX/bin/npm"

git init --bare "$SANDBOX/upstream.git" --quiet
git init "$SANDBOX/primary" --quiet
git -C "$SANDBOX/primary" config user.name 'Train test'
git -C "$SANDBOX/primary" config user.email 'train-test@example.test'
git -C "$SANDBOX/primary" checkout -b main --quiet
printf '%s\n' '{"name":"train-fixture"}' > "$SANDBOX/primary/package.json"
printf '%s\n' 'base' > "$SANDBOX/primary/server/src/example.test.ts"
printf '%s\n' 'base' > "$SANDBOX/primary/docs/base.md"
git -C "$SANDBOX/primary" add package.json server/src/example.test.ts docs/base.md
git -C "$SANDBOX/primary" commit -m 'Initial main' --quiet
printf '%s\n' '.env' >> "$SANDBOX/primary/.git/info/exclude"
printf '%s\n' 'DATABASE_URL=postgresql://postgres:postgres@localhost:5440/maincar2?schema=public' > "$SANDBOX/primary/.env"
git -C "$SANDBOX/primary" remote add origin "$SANDBOX/upstream.git"
git -C "$SANDBOX/primary" push origin main --quiet

primary_real="$(cd "$SANDBOX/primary" && pwd -P)"
train_env=(
  MC_STATE_HOME="$SANDBOX/state"
  MC_MAIN_CHECKOUT="$primary_real"
  MC_LOCAL_MAIN_REPO="$SANDBOX/state/local-main.git"
  MC_FAKE_NPM_LOG="$SANDBOX/npm.log"
  MC_PRIMARY_FAIL_ONCE="$SANDBOX/primary-provision-failed-once"
  PATH="$SANDBOX/bin:$PATH"
)
(
  cd "$SANDBOX/primary"
  env "${train_env[@]}" "$ROOT/.claude/scripts/coord/mc-local-main" sync
)

make_ticket() {
  local path="$1" branch="$2" file="$3" content="$4"
  git clone "$SANDBOX/state/local-main.git" "$path" --quiet
  git -C "$path" config user.name 'Train test'
  git -C "$path" config user.email 'train-test@example.test'
  git -C "$path" checkout -b "$branch" --quiet
  mkdir -p "$(dirname "$path/$file")"
  printf '%s\n' "$content" > "$path/$file"
  git -C "$path" add "$file"
  git -C "$path" commit -m "$branch" --quiet
}

enqueue() {
  local path="$1"
  shift
  (cd "$path" && env "${train_env[@]}" "$TRAIN" enqueue "$@")
}

# Queue records are local state but still cross a trust boundary: malformed or
# tampered metadata must be rejected before it can select a repository or gate.
mkdir -p "$SANDBOX/state/state/train/ready"
printf '1\0372026-01-01T00:00:00Z\037MAI-100\037%s\037%s\037%s\037mai-100-tampered\037unsafe\037low\037docs\037tampered queue\037\n' \
  "$SANDBOX/primary" "$(git -C "$SANDBOX/primary" rev-parse HEAD)" "$(git -C "$SANDBOX/primary" rev-parse HEAD)" \
  > "$SANDBOX/state/state/train/ready/000000001-MAI-100.tsv"
if env "${train_env[@]}" "$TRAIN" status > "$SANDBOX/tampered.out" 2>&1; then
  echo 'train accepted tampered queue metadata' >&2
  exit 1
fi
grep -F 'invalid declared risk' "$SANDBOX/tampered.out" >/dev/null
rm "$SANDBOX/state/state/train/ready/000000001-MAI-100.tsv"

run_train() {
  local path="$1"
  shift
  (cd "$path" && env "${train_env[@]}" "$@" "$TRAIN" run)
}

# Compatible low- and normal-risk entries ride one train. The combined group
# receives one static pass, the union of focused tests, and one relevant suite.
make_ticket "$SANDBOX/mai-101-docs" mai-101-docs docs/delivery.md 'delivery docs'
make_ticket "$SANDBOX/mai-102-server" mai-102-server server/src/change.ts 'server change'
enqueue "$SANDBOX/mai-101-docs" --risk low --coverage 'delivery documentation'
enqueue "$SANDBOX/mai-102-server" --risk normal --coverage 'server behavior and route regression' --test server:src/example.test.ts
if (cd "$SANDBOX/mai-101-docs" && env "${train_env[@]}" "$ROOT/.claude/scripts/coord/mc-merge" -m 'legacy path' > "$SANDBOX/legacy-merge.out" 2>&1); then
  echo 'legacy per-session merge path remained available' >&2
  exit 1
fi
grep -F 'replaced by mc-train' "$SANDBOX/legacy-merge.out" >/dev/null
if ! grep -aF 'server:src/example.test.ts' "$SANDBOX/state/state/train/ready/"*.tsv >/dev/null; then
  echo 'enqueue receipt lost the declared focused test' >&2
  exit 1
fi
test "$(env "${train_env[@]}" "$TRAIN" status --count)" -eq 2
: > "$SANDBOX/npm.log"
run_train "$SANDBOX/mai-102-server" > "$SANDBOX/group.out"
git -C "$SANDBOX/upstream.git" cat-file -e main:docs/delivery.md
git -C "$SANDBOX/upstream.git" cat-file -e main:server/src/change.ts
test "$(grep -cF '|run typecheck|' "$SANDBOX/npm.log")" -eq 1
test "$(grep -cF '|run lint|' "$SANDBOX/npm.log")" -eq 1
if [ "$(grep -cF '|--prefix server exec vitest run src/example.test.ts|' "$SANDBOX/npm.log" || true)" -ne 1 ]; then
  echo 'combined train did not run the focused server test exactly once:' >&2
  sed 's/^/  /' "$SANDBOX/npm.log" >&2
  find "$SANDBOX/state/state/train/runs" -name receipt.tsv -exec sed 's/^/  receipt: /' {} \; >&2
  exit 1
fi
test "$(grep -cF '|run test:server|' "$SANDBOX/npm.log")" -eq 1
test "$(grep -cF '|run verify|' "$SANDBOX/npm.log" || true)" -eq 0
test -f "$SANDBOX/state/state/deliveries/MAI-101.tsv"
test -f "$SANDBOX/state/state/deliveries/MAI-102.tsv"
receipt="$(find "$SANDBOX/state/state/train/runs" -name receipt.tsv -print | head -1)"
grep -F 'risk=normal' "$receipt" >/dev/null
grep -F 'delivery documentation' "$receipt" >/dev/null
grep -F 'server behavior and route regression' "$receipt" >/dev/null
test "$(env "${train_env[@]}" "$TRAIN" status --count)" -eq 0

# A high-risk floor cannot be declared away. Once correctly enqueued, it waits
# behind the normal group and then travels alone with one full verification.
make_ticket "$SANDBOX/mai-103-normal" mai-103-normal server/src/normal.ts 'normal change'
make_ticket "$SANDBOX/mai-104-high" mai-104-high package.json '{"name":"high-risk-change"}'
enqueue "$SANDBOX/mai-103-normal" --risk normal --coverage 'ordinary server behavior' --test server:src/example.test.ts
if enqueue "$SANDBOX/mai-104-high" --risk normal --coverage 'package behavior' > "$SANDBOX/lowered-risk.out" 2>&1; then
  echo 'train accepted a declared risk below the high-risk floor' >&2
  exit 1
fi
grep -F 'requires high risk' "$SANDBOX/lowered-risk.out" >/dev/null
enqueue "$SANDBOX/mai-104-high" --risk high --coverage 'package manifest and shared runtime'
: > "$SANDBOX/npm.log"
run_train "$SANDBOX/mai-103-normal" > "$SANDBOX/normal-boundary.out"
git -C "$SANDBOX/upstream.git" cat-file -e main:server/src/normal.ts
if git -C "$SANDBOX/upstream.git" show main:package.json | grep -F 'high-risk-change' >/dev/null; then
  echo 'high-risk entry traveled with a normal entry' >&2
  exit 1
fi
test "$(env "${train_env[@]}" "$TRAIN" status --count)" -eq 1
: > "$SANDBOX/npm.log"
high_base="$(git -C "$SANDBOX/upstream.git" rev-parse main)"
if run_train "$SANDBOX/mai-104-high" MC_FAKE_FAIL=dependency-prep > "$SANDBOX/dependency-prep.out" 2>&1; then
  echo 'train accepted a failed clean dependency preparation' >&2
  exit 1
fi
test "$(git -C "$SANDBOX/upstream.git" rev-parse main)" = "$high_base"
test "$(grep -cF '|run verify|' "$SANDBOX/npm.log" || true)" -eq 0
test ! -f "$SANDBOX/state/state/deliveries/MAI-104.tsv"
enqueue "$SANDBOX/mai-104-high" --risk high --coverage 'package manifest and shared runtime'
: > "$SANDBOX/npm.log"
run_train "$SANDBOX/mai-104-high" > "$SANDBOX/high.out"
test "$(grep -cF '|run verify|' "$SANDBOX/npm.log")" -eq 1
grep -F 'high-risk-change' "$SANDBOX/primary/package.json" >/dev/null
grep -F -- "$primary_real|ci|" "$SANDBOX/npm.log" >/dev/null
grep -E '/mc-train-run-.*/repo\|ci\|' "$SANDBOX/npm.log" >/dev/null
test "$(env "${train_env[@]}" "$TRAIN" status --count)" -eq 0

# A post-push dependency install failure must not erase durable delivery proof.
# It leaves an exact provisioning receipt and the next conductor retries it.
make_ticket "$SANDBOX/mai-109-provision" mai-109-provision package.json '{"name":"primary-provision-retry"}'
enqueue "$SANDBOX/mai-109-provision" --risk high --coverage 'primary dependency provisioning retry'
run_train "$SANDBOX/mai-109-provision" MC_FAKE_FAIL=primary-provision > "$SANDBOX/provision-failure.out" 2>&1
git -C "$SANDBOX/upstream.git" show main:package.json | grep -F 'primary-provision-retry' >/dev/null
test -f "$SANDBOX/state/state/deliveries/MAI-109.tsv"
if [ ! -f "$SANDBOX/state/state/primary-refresh-pending.tsv" ]; then
  echo 'post-push provisioning failure did not leave a pending receipt' >&2
  sed 's/^/  train: /' "$SANDBOX/provision-failure.out" >&2
  sed 's/^/  npm: /' "$SANDBOX/npm.log" >&2
  exit 1
fi
grep -F 'provisioning failed (roots=.; prisma=0)' "$SANDBOX/state/state/primary-refresh-pending.tsv" >/dev/null
run_train "$SANDBOX/mai-109-provision" MC_FAKE_FAIL=primary-provision > "$SANDBOX/provision-retry.out" 2>&1
test ! -f "$SANDBOX/state/state/primary-refresh-pending.tsv"
grep -F 'runnable environment provisioning is current' "$SANDBOX/provision-retry.out" >/dev/null

# If two individually green changes fail together, the train records an
# interaction failure, pushes neither change, and removes the pair from ready
# work so an operator can resolve it explicitly.
make_ticket "$SANDBOX/mai-105-a" mai-105-a server/src/feature-a.ts 'feature a'
make_ticket "$SANDBOX/mai-106-b" mai-106-b server/src/feature-b.ts 'feature b'
enqueue "$SANDBOX/mai-105-a" --risk normal --coverage 'feature a behavior' --test server:src/example.test.ts
enqueue "$SANDBOX/mai-106-b" --risk normal --coverage 'feature b behavior' --test server:src/example.test.ts
main_before_failure="$(git -C "$SANDBOX/upstream.git" rev-parse main)"
if run_train "$SANDBOX/mai-105-a" MC_FAKE_FAIL=interaction > "$SANDBOX/interaction.out" 2>&1; then
  echo 'train delivered a group whose combined relevant suite failed' >&2
  exit 1
fi
test "$(git -C "$SANDBOX/upstream.git" rev-parse main)" = "$main_before_failure"
failure="$(grep -rl '^kind=interaction$' "$SANDBOX/state/state/train/failed" | head -1)"
grep -F 'interaction' "$failure" >/dev/null
grep -F 'MAI-105' "$failure" >/dev/null
grep -F 'MAI-106' "$failure" >/dev/null
test "$(env "${train_env[@]}" "$TRAIN" status --count)" -eq 0
test ! -f "$SANDBOX/state/state/deliveries/MAI-105.tsv"
test ! -f "$SANDBOX/state/state/deliveries/MAI-106.tsv"

# An add/add conflict ends the compatible prefix. The first entry can deliver;
# the conflicting entry remains ready, then is recorded against newest main on
# the next run instead of contaminating or blocking that earlier delivery.
make_ticket "$SANDBOX/mai-107-prefix" mai-107-prefix server/src/conflict.ts 'first compatible value'
make_ticket "$SANDBOX/mai-108-conflict" mai-108-conflict server/src/conflict.ts 'second conflicting value'
enqueue "$SANDBOX/mai-107-prefix" --risk normal --coverage 'compatible prefix behavior' --test server:src/example.test.ts
enqueue "$SANDBOX/mai-108-conflict" --risk normal --coverage 'conflicting behavior' --test server:src/example.test.ts
run_train "$SANDBOX/mai-107-prefix" > "$SANDBOX/conflict-prefix.out" 2>&1
grep -F 'first compatible value' < <(git -C "$SANDBOX/upstream.git" show main:server/src/conflict.ts) >/dev/null
test -f "$SANDBOX/state/state/deliveries/MAI-107.tsv"
test ! -f "$SANDBOX/state/state/deliveries/MAI-108.tsv"
test "$(env "${train_env[@]}" "$TRAIN" status --count)" -eq 1
if run_train "$SANDBOX/mai-108-conflict" > "$SANDBOX/conflict-main.out" 2>&1; then
  echo 'train accepted an entry that conflicts with newest main' >&2
  exit 1
fi
grep -rlF 'kind=conflict-with-main' "$SANDBOX/state/state/train/failed" >/dev/null
test "$(env "${train_env[@]}" "$TRAIN" status --count)" -eq 0

echo 'mc-train local delivery train: PASS'
