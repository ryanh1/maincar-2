#!/usr/bin/env bash
# Regression coverage for issue-clone environment provisioning and migration authoring.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
CLONE="$ROOT/.claude/scripts/coord/mc-clone"
MIGRATE="$ROOT/.claude/scripts/coord/mc-migrate"
SANDBOX="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/mc-environment-test-XXXXXX")" && pwd -P)"
trap 'rm -rf "$SANDBOX"' EXIT

grep -F './.claude/scripts/coord/mc-clone' "$ROOT/AGENTS.md" >/dev/null
if grep -F 'git clone ~/code/maincar-2-coord/local-main.git' "$ROOT/AGENTS.md" >/dev/null; then
  echo 'root workflow instructions still recommend a raw issue clone' >&2
  exit 1
fi

git init --bare "$SANDBOX/upstream.git" --quiet
git init "$SANDBOX/primary" --quiet
git -C "$SANDBOX/primary" config user.name 'Environment test'
git -C "$SANDBOX/primary" config user.email 'environment-test@example.test'
git -C "$SANDBOX/primary" checkout -b main --quiet
printf '.env\n' > "$SANDBOX/primary/.gitignore"
printf 'DATABASE_URL=postgresql://postgres:postgres@localhost:5440/maincar2?schema=public\n' > "$SANDBOX/primary/.env"
touch "$SANDBOX/primary/tracked-placeholder"
for package_root in . server vite firebase; do
  package_dir="$SANDBOX/primary/$package_root"
  mkdir -p "$package_dir"
  printf '{"name":"%s","version":"1.0.0"}\n' "${package_root//\//-}" > "$package_dir/package.json"
  printf '{"name":"%s","lockfileVersion":3,"requires":true,"packages":{}}\n' "${package_root//\//-}" > "$package_dir/package-lock.json"
done
mkdir -p "$SANDBOX/primary/server/prisma"
touch "$SANDBOX/primary/server/prisma/schema.prisma"
mkdir -p "$SANDBOX/primary/.claude/scripts/coord"
cp "$ROOT/.claude/scripts/coord/mc-bootstrap" "$ROOT/.claude/scripts/coord/mc-common.sh" "$SANDBOX/primary/.claude/scripts/coord/"
chmod +x "$SANDBOX/primary/.claude/scripts/coord/mc-bootstrap"
git -C "$SANDBOX/primary" add .gitignore tracked-placeholder package.json package-lock.json server vite firebase .claude
git -C "$SANDBOX/primary" commit -m 'Initial main' --quiet
git -C "$SANDBOX/primary" remote add origin "$SANDBOX/upstream.git"
git -C "$SANDBOX/primary" push origin main --quiet

test_env=(
  MC_STATE_HOME="$SANDBOX/state"
  MC_MAIN_CHECKOUT="$SANDBOX/primary"
  MC_LOCAL_MAIN_REPO="$SANDBOX/state/local-main.git"
)
(cd "$SANDBOX/primary" && env "${test_env[@]}" "$ROOT/.claude/scripts/coord/mc-local-main" sync)

for package_root in . server vite firebase; do
  package_dir="$SANDBOX/primary/$package_root"
  mkdir -p "$package_dir/node_modules"
  touch "$package_dir/node_modules/.mc-primary-dependency"
done

mkdir -p "$SANDBOX/bin"
cat > "$SANDBOX/bin/npm" <<'EOF'
#!/usr/bin/env bash
printf '%s|%s\n' "$PWD" "$*" >> "$MC_FAKE_NPM_LOG"
case "$1" in
  ci) mkdir -p node_modules; touch node_modules/.mc-bootstrap-installed ;;
  --prefix)
    [ -d "$2/node_modules" ] || exit 17
    ;;
esac
EOF
chmod +x "$SANDBOX/bin/npm"

clone_env=("${test_env[@]}" MC_FAKE_NPM_LOG="$SANDBOX/npm.log" PATH="$SANDBOX/bin:$PATH")
: > "$SANDBOX/npm.log"
env "${clone_env[@]}" "$CLONE" "$SANDBOX/issue-clone"
test -f "$SANDBOX/issue-clone/.env"
test ! -L "$SANDBOX/issue-clone/.env"
cmp -s "$SANDBOX/primary/.env" "$SANDBOX/issue-clone/.env"
for package_root in . server vite firebase; do
  primary_package_dir="$SANDBOX/primary/$package_root"
  clone_package_dir="$SANDBOX/issue-clone/$package_root"
  test -L "$clone_package_dir/node_modules"
  test "$(readlink "$clone_package_dir/node_modules")" = "$primary_package_dir/node_modules"
  test -f "$clone_package_dir/node_modules/.mc-primary-dependency"
done
if grep -F '|ci' "$SANDBOX/npm.log" >/dev/null; then
  echo 'mc-clone reinstalled dependencies despite matching package manifests' >&2
  exit 1
fi
if ! (cd "$SANDBOX/issue-clone" && env "${clone_env[@]}" "$ROOT/.claude/scripts/coord/mc-gate" --focused -- npm --prefix server exec vitest run src/example.test.ts); then
  echo 'mc-clone did not provision the dependencies needed for Prisma generation' >&2
  exit 1
fi

git clone "$SANDBOX/upstream.git" "$SANDBOX/manifest-updater" --quiet
git -C "$SANDBOX/manifest-updater" config user.name 'Environment test'
git -C "$SANDBOX/manifest-updater" config user.email 'environment-test@example.test'
git -C "$SANDBOX/manifest-updater" checkout main --quiet
printf '{"name":"server","lockfileVersion":3,"requires":true,"packages":{"":{"version":"2.0.0"}}}\n' > "$SANDBOX/manifest-updater/server/package-lock.json"
git -C "$SANDBOX/manifest-updater" add server/package-lock.json
git -C "$SANDBOX/manifest-updater" commit -m 'Change server package lock' --quiet
git -C "$SANDBOX/manifest-updater" push origin main --quiet
(cd "$SANDBOX/primary" && env "${test_env[@]}" "$ROOT/.claude/scripts/coord/mc-local-main" sync)

: > "$SANDBOX/npm.log"
env "${clone_env[@]}" "$CLONE" "$SANDBOX/changed-lock-clone"
test ! -L "$SANDBOX/changed-lock-clone/server/node_modules"
test -f "$SANDBOX/changed-lock-clone/server/node_modules/.mc-bootstrap-installed"
test "$(grep -Fc '|ci' "$SANDBOX/npm.log")" -eq 1
for package_root in . vite firebase; do
  primary_package_dir="$SANDBOX/primary/$package_root"
  clone_package_dir="$SANDBOX/changed-lock-clone/$package_root"
  test -L "$clone_package_dir/node_modules"
  test "$(readlink "$clone_package_dir/node_modules")" = "$primary_package_dir/node_modules"
done

: > "$SANDBOX/npm.log"
(cd "$SANDBOX/changed-lock-clone" && env "${clone_env[@]}" ./.claude/scripts/coord/mc-bootstrap)
test "$(grep -Fc '|ci' "$SANDBOX/npm.log")" -eq 1

rm -rf "$SANDBOX/issue-clone/server/node_modules"
: > "$SANDBOX/npm.log"
if (cd "$SANDBOX/issue-clone" && env "${clone_env[@]}" "$ROOT/.claude/scripts/coord/mc-gate" --focused -- npm --prefix server exec vitest run src/example.test.ts >"$SANDBOX/incomplete-clone.out" 2>&1); then
  echo 'mc-gate allowed an incomplete clone to run' >&2
  exit 1
fi
grep -F 'Run ./.claude/scripts/coord/mc-bootstrap' "$SANDBOX/incomplete-clone.out" >/dev/null
if grep -F 'run db:generate' "$SANDBOX/npm.log" >/dev/null; then
  echo 'mc-gate attempted Prisma generation after detecting incomplete dependencies' >&2
  exit 1
fi

printf 'MIGRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5440/primary-fallback\n' > "$SANDBOX/primary/.env"
if cmp -s "$SANDBOX/primary/.env" "$SANDBOX/issue-clone/.env"; then
  echo 'mc-clone linked .env instead of copying it' >&2
  exit 1
fi

mkdir -p "$SANDBOX/migration-clone/server/prisma/migrations"
cat > "$SANDBOX/bin/docker" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$MC_FAKE_DOCKER_LOG"
EOF
cat > "$SANDBOX/bin/npx" <<'EOF'
#!/usr/bin/env bash
printf 'DATABASE_URL=%s\nMIGRATE_DATABASE_URL=%s\nARGS=%s\n' "$DATABASE_URL" "$MIGRATE_DATABASE_URL" "$*" >> "$MC_FAKE_NPX_LOG"
EOF
chmod +x "$SANDBOX/bin/docker" "$SANDBOX/bin/npx"

git init "$SANDBOX/migration-clone" --quiet
git -C "$SANDBOX/migration-clone" config user.name 'Environment test'
git -C "$SANDBOX/migration-clone" config user.email 'environment-test@example.test'
git -C "$SANDBOX/migration-clone" checkout -b mai-463-environment-test --quiet
touch "$SANDBOX/migration-clone/placeholder"
git -C "$SANDBOX/migration-clone" add .
git -C "$SANDBOX/migration-clone" commit -m 'Migration fixture' --quiet
printf 'DATABASE_URL=postgresql://postgres:postgres@localhost:5440/maincar2?schema=public\n' > "$SANDBOX/migration-clone/.env"
mkdir -p "$SANDBOX/state/state"
: > "$SANDBOX/state/state/known-migration-timestamps.txt"

(cd "$SANDBOX/migration-clone" && \
  env "${test_env[@]}" \
    MC_SKIP_SCAN=1 \
    MC_FAKE_DOCKER_LOG="$SANDBOX/docker.log" \
    MC_FAKE_NPX_LOG="$SANDBOX/npx.log" \
    PATH="$SANDBOX/bin:$PATH" \
    "$MIGRATE" add_environment_guard)

grep -F 'CREATE DATABASE "maincar2_authoring_' "$SANDBOX/docker.log" >/dev/null
grep -F 'DATABASE_URL=postgresql://postgres:postgres@localhost:5440/maincar2_authoring_' "$SANDBOX/npx.log" >/dev/null
grep -F 'MIGRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5440/maincar2_authoring_' "$SANDBOX/npx.log" >/dev/null
if grep -F 'DATABASE_URL=postgresql://postgres:postgres@localhost:5440/maincar2?schema=public' "$SANDBOX/npx.log" >/dev/null; then
  echo 'mc-migrate authored against the configured database' >&2
  exit 1
fi

printf 'MIGRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5440/legacy-override?source=legacy\nDATABASE_URL=postgresql://postgres:postgres@localhost:5440/maincar2?source=database\n' > "$SANDBOX/migration-clone/.env"
(cd "$SANDBOX/migration-clone" && \
  env "${test_env[@]}" \
    MC_SKIP_SCAN=1 \
    MC_FAKE_DOCKER_LOG="$SANDBOX/docker.log" \
    MC_FAKE_NPX_LOG="$SANDBOX/npx.log" \
    PATH="$SANDBOX/bin:$PATH" \
    "$MIGRATE" add_legacy_override_guard)
grep -E 'DATABASE_URL=postgresql://postgres:postgres@localhost:5440/maincar2_authoring_[0-9]+\?source=legacy' "$SANDBOX/npx.log" >/dev/null

(cd "$SANDBOX/migration-clone" && \
  env "${test_env[@]}" \
    MC_SKIP_SCAN=1 \
    MC_MIGRATE_URL='postgresql://postgres:postgres@localhost:5440/explicit-override?source=explicit' \
    MC_FAKE_DOCKER_LOG="$SANDBOX/docker.log" \
    MC_FAKE_NPX_LOG="$SANDBOX/npx.log" \
    PATH="$SANDBOX/bin:$PATH" \
    "$MIGRATE" add_explicit_override_guard)
grep -E 'DATABASE_URL=postgresql://postgres:postgres@localhost:5440/maincar2_authoring_[0-9]+\?source=explicit' "$SANDBOX/npx.log" >/dev/null

echo 'mc environment setup and migration safety: PASS'
