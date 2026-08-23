# Shared helpers for the maincar-2 coordination scripts. Sourced, never run.
#
# The SCRIPTS are tracked in the repo, so they are reviewable and every worktree
# gets them. The STATE is deliberately NOT: git gives each worktree its own copy of
# a tracked file, and a claim board that is not shared between worktrees is not a
# claim board. So state lives in one directory outside every checkout.
COORD="${MC_STATE_HOME:-$HOME/code/maincar-2-coord}"
STATE="$COORD/state"
mkdir -p "$STATE/claims" "$STATE/locks" "$STATE/ports" "$COORD/inbox" "$COORD/log"
COORD_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PRIMARY_CHECKOUT="${MC_MAIN_CHECKOUT:-$HOME/Documents/Coding/My Projects/maincar-2}"
LOCAL_MAIN_REPO="${MC_LOCAL_MAIN_REPO:-$COORD/local-main.git}"

# The worktree this shell is in. Identity for slots and claims.
mc_worktree() { git rev-parse --show-toplevel 2>/dev/null || pwd; }
mc_branch()   { git rev-parse --abbrev-ref HEAD 2>/dev/null || echo detached; }
mc_now()      { date -u +%Y-%m-%dT%H:%M:%SZ; }

# The primary checkout is for a person to inspect. It is never a ticket workspace
# or a Git remote: either role lets an unfinished session block every other one.
mc_assert_ticket_checkout() {
  local primary worktree
  primary="$(cd "$PRIMARY_CHECKOUT" && pwd -P)" || return 1
  worktree="$(cd "$(mc_worktree)" && pwd -P)" || return 1
  if [ "$worktree" = "$primary" ]; then
    echo "mc: the primary checkout is not a ticket workspace. Use an issue clone." >&2
    return 1
  fi
}

# GitHub remains the durable remote. The local bare mirror is the fast, clean
# source that every ticket fetches. Unlike a working checkout, a bare repository
# cannot carry uncommitted files that make another ticket's push fail.
mc_canonical_upstream_url() {
  if [ -d "$LOCAL_MAIN_REPO" ]; then
    git -C "$LOCAL_MAIN_REPO" remote get-url upstream 2>/dev/null && return 0
  fi
  git -C "$PRIMARY_CHECKOUT" remote get-url origin
}

mc_sync_local_main() {
  local upstream
  upstream="$(mc_canonical_upstream_url)" || return 1
  if [ ! -d "$LOCAL_MAIN_REPO" ]; then
    git clone --bare "$upstream" "$LOCAL_MAIN_REPO" >/dev/null
    git -C "$LOCAL_MAIN_REPO" remote rename origin upstream
  fi
  git -C "$LOCAL_MAIN_REPO" rev-parse --is-bare-repository >/dev/null || {
    echo "mc: local main mirror is not a bare repository: $LOCAL_MAIN_REPO" >&2
    return 1
  }
  install -m 755 "$COORD_SCRIPTS_DIR/hooks/local-main-pre-receive" "$LOCAL_MAIN_REPO/hooks/pre-receive"
  mkdir -p "$COORD/primary-hooks"
  install -m 755 "$COORD_SCRIPTS_DIR/hooks/primary-pre-commit" "$COORD/primary-hooks/pre-commit"
  install -m 755 "$COORD_SCRIPTS_DIR/hooks/primary-pre-push" "$COORD/primary-hooks/pre-push"
  # This must be worktree-local. A normal local config is shared by every linked
  # worktree, which would block the issue clone while enqueueing for mc-train.
  git -C "$PRIMARY_CHECKOUT" config --local --unset-all core.hooksPath 2>/dev/null || true
  git -C "$PRIMARY_CHECKOUT" config --worktree core.hooksPath "$COORD/primary-hooks"
  git -C "$LOCAL_MAIN_REPO" remote remove origin 2>/dev/null || true
  git -C "$LOCAL_MAIN_REPO" remote set-url upstream "$upstream" 2>/dev/null || git -C "$LOCAL_MAIN_REPO" remote add upstream "$upstream"
  git -C "$LOCAL_MAIN_REPO" fetch upstream --prune '+refs/heads/main:refs/heads/main' >/dev/null
}

# Dependency manifests change the runnable environment as well as tracked source.
# Return the affected package roots, one per line, so an explicit refresh can
# reinstall exactly those roots from their committed locks.
mc_changed_dependency_roots() {
  local checkout="$1" from="HEAD" to="$2" path
  if [ "$#" -eq 3 ]; then
    from="$2"
    to="$3"
  fi
  while IFS= read -r path; do
    case "$path" in
      package.json|package-lock.json) printf '.\n' ;;
      server/package.json|server/package-lock.json) printf 'server\n' ;;
      vite/package.json|vite/package-lock.json) printf 'vite\n' ;;
      firebase/package.json|firebase/package-lock.json) printf 'firebase\n' ;;
    esac
  done < <(git -C "$checkout" diff --name-only "$from" "$to") | sort -u
}

mc_sync_dependencies() {
  local checkout="$1" root
  while IFS= read -r root; do
    [ -n "$root" ] || continue
    if [ "$root" = '.' ]; then
      (cd "$checkout" && npm ci) || return 1
    else
      (cd "$checkout/$root" && npm ci) || return 1
    fi
  done
}

mc_provision_primary_checkout() {
  local primary="$1" roots_csv="$2" prisma_required="$3"
  if [ "$roots_csv" != "-" ]; then
    printf '%s\n' "$roots_csv" | tr ',' '\n' | mc_sync_dependencies "$primary" || return 1
  fi
  if [ "$prisma_required" = "1" ]; then
    echo "[mc-primary] applying tracked Prisma migrations."
    (cd "$primary/server" && npx prisma migrate deploy) || return 1
  fi
}

# A changed Prisma schema or migration can make a freshly refreshed server fail
# at runtime until the local database has caught up.
mc_prisma_refresh_required() {
  local primary="$1" target="$2"
  ! git -C "$primary" diff --quiet HEAD "$target" -- server/prisma/schema.prisma server/prisma/migrations
}

mc_primary_refresh_pending_file() { printf '%s\n' "$STATE/primary-refresh-pending.tsv"; }
mc_primary_refresh_command() { printf '%s\n' 'npm run mirror-to-main'; }

mc_record_primary_refresh_pending() {
  local reason="$1" primary="${2:-}" target="${3:-}" command="${4:-}" file tmp primary_sha="-" target_sha="-"
  file="$(mc_primary_refresh_pending_file)"
  [ -n "$command" ] || command="$(mc_primary_refresh_command)"
  [ -n "$primary" ] && primary_sha="$(git -C "$primary" rev-parse --short HEAD 2>/dev/null || echo '-')"
  [ -n "$target" ] && target_sha="$(git -C "$primary" rev-parse --short "$target" 2>/dev/null || echo '-')"
  tmp="$(mktemp "$STATE/.primary-refresh-pending.XXXXXX")"
  printf '%s\t%s\t%s\t%s\t%s\n' "$(mc_now)" "$primary_sha" "$target_sha" "$reason" "$command" > "$tmp"
  mv "$tmp" "$file"
  echo "[mc-primary] REFRESH REQUIRED: $reason" >&2
  echo "[mc-primary] Next: $command" >&2
}

mc_clear_primary_refresh_pending() {
  rm -f "$(mc_primary_refresh_pending_file)"
}

# A runnable checkout must not change under a local dev process. Tests inject a
# deterministic PID list; normal operation checks only this project's default
# listener ports and therefore does not mistake unrelated processes for Maincar.
mc_primary_active_process_pids() {
  local primary="${1:-$PRIMARY_CHECKOUT}" pid cwd
  if [ -n "${MC_PRIMARY_ACTIVE_PROCESS_PIDS:-}" ]; then
    printf '%s\n' "$MC_PRIMARY_ACTIVE_PROCESS_PIDS"
    return
  fi
  command -v lsof >/dev/null 2>&1 || return 0
  for port in 3010 5183 9140 4140 8140 9240; do
    lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
  done | sort -nu | while IFS= read -r pid; do
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    case "$cwd/" in "$primary/"*) printf '%s\n' "$pid" ;; esac
  done | tr '\n' ' ' | sed 's/[[:space:]]*$//'
}

# The primary checkout is for running and inspecting the application, never for
# delivery. After GitHub accepts a delivery and the bare mirror is refreshed,
# it can fast-forward only when the checkout is clean and no Maincar process is
# actively using it.
mc_refresh_primary_checkout() {
  local primary branch target dependency_roots dependency_roots_csv refresh_requirements prisma_refresh_required=0 active_pids local_changes
  local pending_file pending_at pending_head pending_target pending_reason pending_command details retry_roots retry_prisma
  primary="$(cd "$PRIMARY_CHECKOUT" && pwd -P)" || {
    echo "[mc-primary] not refreshed: primary checkout is unavailable: $PRIMARY_CHECKOUT" >&2
    return 0
  }
  branch="$(git -C "$primary" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  if [ "$branch" != "main" ]; then
    echo "[mc-primary] not refreshed: primary checkout is on ${branch:-detached}, not main." >&2
    mc_record_primary_refresh_pending "primary checkout is on ${branch:-detached}, not main" "$primary"
    return 0
  fi

  if ! git -C "$primary" fetch --quiet "$LOCAL_MAIN_REPO" main:refs/remotes/origin/main; then
    echo "[mc-primary] not refreshed: could not read delivered main from the local mirror." >&2
    mc_record_primary_refresh_pending 'could not read delivered main from the local mirror' "$primary"
    return 0
  fi
  target="origin/main"

  if ! git -C "$primary" merge-base --is-ancestor HEAD "$target"; then
    echo "[mc-primary] not refreshed: primary main has commits not in delivered main." >&2
    mc_record_primary_refresh_pending 'primary main has commits not in delivered main' "$primary" "$target"
    return 0
  fi

  # The normal checkout is a person's runnable copy. Even unrelated untracked
  # work is evidence that a person is using it, so do not advance source under
  # that work. Preserve everything and leave one exact follow-up command.
  local_changes="$(git -C "$primary" status --short)"
  if [ -n "$local_changes" ]; then
    echo "[mc-primary] not refreshed: the primary checkout has personal uncommitted or untracked work:" >&2
    printf '%s\n' "$local_changes" | sed 's/^/  /' >&2
    mc_record_primary_refresh_pending "primary checkout has personal work: $(printf '%s\n' "$local_changes" | tr '\n' ' ')" "$primary" "$target"
    return 0
  fi

  active_pids="$(mc_primary_active_process_pids "$primary")"
  if [ -n "$active_pids" ]; then
    echo "[mc-primary] not refreshed: active local process(es) are using the runnable checkout: $active_pids" >&2
    echo "[mc-primary] stop those processes, then run $(mc_primary_refresh_command)." >&2
    mc_record_primary_refresh_pending "active local process(es): $active_pids" "$primary" "$target"
    return 0
  fi

  # Delivery and runnable-environment provisioning are separate durable facts.
  # If GitHub and the primary source already advanced but npm/Prisma failed,
  # retain enough detail to retry the exact local provisioning work safely.
  pending_file="$(mc_primary_refresh_pending_file)"
  if [ -f "$pending_file" ]; then
    IFS=$'\t' read -r pending_at pending_head pending_target pending_reason pending_command < "$pending_file" || true
    if [ "$(git -C "$primary" rev-parse --short HEAD)" = "$pending_target" ]; then
      case "$pending_reason" in
        'provisioning failed (roots='*)
          details="${pending_reason#provisioning failed (roots=}"
          retry_roots="${details%%; prisma=*}"
          retry_prisma="${details##*; prisma=}"
          retry_prisma="${retry_prisma%)}"
          case "$retry_roots" in -|.|server|vite|firebase|*,*) ;; *) retry_roots="-" ;; esac
          case "$retry_prisma" in 0|1) ;; *) retry_prisma=0 ;; esac
          echo "[mc-primary] retrying pending runnable-environment provisioning."
          if mc_provision_primary_checkout "$primary" "$retry_roots" "$retry_prisma"; then
            mc_clear_primary_refresh_pending
            echo "[mc-primary] runnable environment provisioning is current."
          else
            mc_record_primary_refresh_pending "$pending_reason" "$primary" "$target"
          fi
          return 0
          ;;
      esac
    fi
  fi

  dependency_roots="$(mc_changed_dependency_roots "$primary" "$target")"
  dependency_roots_csv="$(printf '%s\n' "$dependency_roots" | sed '/^$/d' | paste -sd, -)"
  [ -n "$dependency_roots_csv" ] || dependency_roots_csv="-"
  refresh_requirements=""
  if [ -n "$dependency_roots" ]; then refresh_requirements="dependency manifests"; fi
  if mc_prisma_refresh_required "$primary" "$target"; then
    prisma_refresh_required=1
    refresh_requirements="${refresh_requirements:+$refresh_requirements and }Prisma schema/migrations"
  fi
  if [ -n "$refresh_requirements" ] && [ "${MC_PRIMARY_ALLOW_DEPENDENCY_REFRESH:-}" != "1" ]; then
    echo "[mc-primary] not refreshed: delivered $refresh_requirements changed; keeping the runnable checkout on $(git -C "$primary" rev-parse --short HEAD)." >&2
    echo "[mc-primary] run $(mc_primary_refresh_command) to fast-forward and synchronize the runnable environment." >&2
    mc_record_primary_refresh_pending "delivered $refresh_requirements changed" "$primary" "$target"
    return 0
  fi

  if git -C "$primary" merge --ff-only "$target" >/dev/null; then
    echo "[mc-primary] fast-forwarded runnable checkout to $(git -C "$primary" rev-parse --short HEAD)."
    if [ -n "$dependency_roots" ]; then
      echo "[mc-primary] synchronizing dependencies for: $(tr '\n' ' ' <<< "$dependency_roots")"
    fi
    if ! mc_provision_primary_checkout "$primary" "$dependency_roots_csv" "$prisma_refresh_required"; then
      mc_record_primary_refresh_pending "provisioning failed (roots=$dependency_roots_csv; prisma=$prisma_refresh_required)" "$primary" "$target"
      return 0
    fi
    mc_clear_primary_refresh_pending
  else
    echo "[mc-primary] not refreshed: primary checkout could not fast-forward safely." >&2
    mc_record_primary_refresh_pending 'primary checkout could not fast-forward safely' "$primary" "$target"
  fi
}

mc_adopt_local_main() {
  local current
  current="$(git remote get-url origin 2>/dev/null || true)"
  if [ "$current" != "$LOCAL_MAIN_REPO" ]; then
    git config --worktree remote.origin.url "$LOCAL_MAIN_REPO"
    echo "[mc] migrated ticket origin to local main mirror: $LOCAL_MAIN_REPO"
  fi
}

mc_fetch_local_main() {
  mc_sync_local_main || return 1
  mc_adopt_local_main || return 1
  git fetch "$@" origin
}

# The Prisma client is ignored, so every checkout must generate its own copy
# from the committed schema before TypeScript checks database code. Never hide
# a failed generation: a stale client otherwise causes misleading later errors.
mc_ensure_prisma_client() {
  local worktree
  worktree="$(mc_worktree)"
  [ -f "$worktree/server/prisma/schema.prisma" ] || return 0
  echo "[mc] generating the Prisma client from the committed schema"
  npm --prefix "$worktree/server" run db:generate
}

mc_issue_key_from_text() {
  local text="$1"
  printf '%s\n' "$text" | grep -Eo '[[:alpha:]]+-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]'
}

# Record a delivery only after GitHub accepted main and the bare mirror refreshed.
# mc-closeout verifies this receipt before an agent may set Linear to Done.
mc_record_delivery() {
  local branch="$1" main_sha="$2" upstream="$3" issue tmp
  issue="$(mc_issue_key_from_text "$branch" || true)"
  [ -n "$issue" ] || return 0
  mkdir -p "$STATE/deliveries"
  tmp="$(mktemp "$STATE/deliveries/.${issue}.XXXXXX")"
  printf '%s\t%s\t%s\t%s\t%s\n' "$issue" "$branch" "$main_sha" "$upstream" "$(mc_now)" > "$tmp"
  mv "$tmp" "$STATE/deliveries/$issue.tsv"
}

# Legacy per-branch receipt helpers remain only for the isolated pre-train merge
# regression fixture. Production delivery receipts are written by mc-train.
mc_delivery_receipt_file() {
  local head="$1"
  printf '%s\n' "$STATE/delivery-gates/$head.tsv"
}

mc_record_delivery_gate() {
  local head="$1" base="$2" branch="$3" file tmp
  mkdir -p "$STATE/delivery-gates"
  file="$(mc_delivery_receipt_file "$head")"
  tmp="$(mktemp "$STATE/delivery-gates/.${head}.XXXXXX")"
  printf '%s\t%s\t%s\t%s\n' "$head" "$base" "$branch" "$(mc_now)" > "$tmp"
  mv "$tmp" "$file"
}

mc_require_delivery_receipt() {
  local head="$1" base="$2" branch="$3" file receipt_head receipt_base receipt_branch receipt_at
  file="$(mc_delivery_receipt_file "$head")"
  if [ ! -r "$file" ]; then
    echo "mc-merge fixture: no legacy receipt for this branch head." >&2
    return 1
  fi
  IFS=$'\t' read -r receipt_head receipt_base receipt_branch receipt_at < "$file" || true
  if [ "$receipt_head" != "$head" ] || [ "$receipt_base" != "$base" ] || [ "$receipt_branch" != "$branch" ]; then
    echo "mc-merge fixture: legacy receipt is stale for the current branch or main." >&2
    return 1
  fi
}

# Log every coordination event so the coordinator can see history.
mc_log() { printf '%s\t%s\t%s\t%s\n' "$(mc_now)" "$$" "$(basename "$(mc_worktree)")" "$*" >> "$COORD/log/events.tsv"; }

# --- title MEANING overlap for mc-claim (not applicable to maincar-2 yet) ---
# Keeping this function for completeness and future use.
mc_title_overlap() { # <title-a> <title-b> -> prints integer percent 0..100
  awk -v A="$1" -v B="$2" '
  function norm(s, arr,   i, n, parts, tok, cnt) {
    gsub(/[^a-zA-Z0-9]+/, " ", s); s = tolower(s);
    n = split(s, parts, " "); cnt = 0;
    for (i = 1; i <= n; i++) {
      tok = parts[i];
      if (tok == "" || (tok in stop)) continue;
      if (!(tok in arr)) { arr[tok] = 1; cnt++; }
    }
    return cnt;
  }
  BEGIN {
    split("the a an and or of to for that with in on is are be it its their they have has show shows whether when", s2, " ");
    for (i in s2) stop[s2[i]] = 1;
    if (norm(A, wa) == 0 || norm(B, wb) == 0) { print 0; exit }
    inter = 0; for (w in wa) if (w in wb) inter++;
    uni = 0;   for (w in wa) uni++;
    for (w in wb) if (!(w in wa)) uni++;
    if (uni == 0) { print 0; exit }
    printf "%d\n", (inter * 100) / uni;
  }'
}

# --- atomic lock via mkdir, with stale reaping by pid ---
# mc_lock_acquire <lockdir> <timeout-seconds>  -> 0 ok, 1 timeout
mc_lock_acquire() {
  local dir="$1" timeout="${2:-300}" waited=0 owner
  while :; do
    # Let a live creator finish recording its PID before deciding an empty
    # directory came from an interrupted creator. Checking before mkdir avoids
    # repeatedly touching the directory while a contender is inspecting it.
    if [ -d "$dir" ] && [ ! -s "$dir/pid" ]; then
      sleep 1
      if [ -d "$dir" ] && [ ! -s "$dir/pid" ]; then
        rm -rf "$dir" 2>/dev/null
        continue
      fi
    fi
    if mkdir "$dir" 2>/dev/null; then echo $$ > "$dir/pid"; return 0; fi
    # Reap a lock whose owner died.
    owner=$(cat "$dir/pid" 2>/dev/null || echo "")
    if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
      rm -rf "$dir" 2>/dev/null; continue
    fi
    # If an interrupted process died between mkdir and writing its PID, the old
    # code waited until timeout forever. The pre-mkdir check above gives a live
    # creator a moment to finish before recovering an empty directory.
    if [ -z "$owner" ]; then
      continue
    fi
    [ "$waited" -ge "$timeout" ] && return 1
    sleep 1; waited=$((waited+1))
  done
}
mc_lock_release() { rm -rf "$1" 2>/dev/null; }

# --- delivery-train risk and scope classifiers --------------------------------
# These are conservative, auditable floors. The enqueue command records both
# the declared risk and this path-derived suggestion. A person may explicitly
# classify a contained client/server change as low, but no declaration can
# lower a high-risk floor (dependencies, data, auth, permissions, billing,
# scheduling, shared coordination, concurrency, or a cross-system change).
mc_scope_for_files() {
  local has_full=0 has_server=0 has_web=0 any=0 f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    any=1
    case "$f" in
      server/prisma/schema.prisma|server/prisma/migrations/*) has_full=1 ;;
      package.json|package-lock.json|*/package.json|*/package-lock.json) has_full=1 ;;
      tsconfig*.json|*/tsconfig*.json) has_full=1 ;;
      server/*) has_server=1 ;;
      vite/*) has_web=1 ;;
      docs/*|*.md) ;;
      *) has_full=1 ;;
    esac
  done
  if [ "$any" -eq 0 ]; then echo full; return; fi
  if [ "$has_full" -eq 1 ]; then echo full; return; fi
  if [ "$has_server" -eq 1 ] && [ "$has_web" -eq 1 ]; then echo full; return; fi
  if [ "$has_server" -eq 1 ]; then echo server; return; fi
  if [ "$has_web" -eq 1 ]; then echo web; return; fi
  echo docs
}

mc_risk_for_files() {
  local scope f lower sensitive=0
  # Read once because both the sensitivity scan and scope classifier need the
  # exact same immutable list.
  local files
  files="$(cat)"
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    lower="$(printf '%s' "$f" | tr '[:upper:]' '[:lower:]')"
    case "$lower" in
      package.json|package-lock.json|*/package.json|*/package-lock.json|\
      agents.md|claude.md|server/prisma/*|.githooks/*|.claude/rules/*|.claude/scripts/coord/*|\
      *auth*|*permission*|*billing*|*schedule*|*concurren*|*infrastructure*)
        sensitive=1
        ;;
    esac
  done <<< "$files"
  [ "$sensitive" -eq 1 ] && { echo high; return; }
  scope="$(printf '%s\n' "$files" | mc_scope_for_files)"
  case "$scope" in
    docs) echo low ;;
    server|web) echo normal ;;
    *) echo high ;;
  esac
}

# Backward-compatible name for callers that only need suite scope.
mc_classify_files() { mc_scope_for_files; }

# Print the set of files that differ from the merge base with origin/main, UNION
# the working-tree changes (staged, unstaged, and untracked). The union is what
# makes classification safe: uncommitted code cannot hide from the gate. Prints
# nothing and returns 1 if the merge base cannot be determined or we are on main —
# the caller must then treat that as `full`.
mc_changed_files() {
  local base
  [ "$(mc_branch)" = "main" ] && return 1
  base="$(git merge-base HEAD origin/main 2>/dev/null || true)"
  [ -z "$base" ] && return 1
  {
    git diff --name-only "$base"..HEAD 2>/dev/null
    git diff --name-only HEAD 2>/dev/null           # unstaged tracked edits
    git diff --name-only --cached 2>/dev/null       # staged edits
    git ls-files --others --exclude-standard 2>/dev/null  # untracked new files
  } | sort -u
}
