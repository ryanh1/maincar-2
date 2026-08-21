# Shared helpers for the maincar-2 coordination scripts. Sourced, never run.
#
# The SCRIPTS are tracked in the repo, so they are reviewable and every worktree
# gets them. The STATE is deliberately NOT: git gives each worktree its own copy of
# a tracked file, and a claim board that is not shared between worktrees is not a
# claim board. So state lives in one directory outside every checkout.
COORD="${MC_STATE_HOME:-$HOME/code/maincar-2-coord}"
STATE="$COORD/state"
mkdir -p "$STATE/claims" "$STATE/locks" "$STATE/ports" "$COORD/inbox" "$COORD/log"

# The worktree this shell is in. Identity for slots and claims.
mc_worktree() { git rev-parse --show-toplevel 2>/dev/null || pwd; }
mc_branch()   { git rev-parse --abbrev-ref HEAD 2>/dev/null || echo detached; }
mc_now()      { date -u +%Y-%m-%dT%H:%M:%SZ; }

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
  local dir="$1" timeout="${2:-300}" waited=0
  while :; do
    if mkdir "$dir" 2>/dev/null; then echo $$ > "$dir/pid"; return 0; fi
    # Reap a lock whose owner died.
    local owner; owner=$(cat "$dir/pid" 2>/dev/null || echo "")
    if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
      rm -rf "$dir" 2>/dev/null; continue
    fi
    [ "$waited" -ge "$timeout" ] && return 1
    sleep 2; waited=$((waited+2))
  done
}
mc_lock_release() { rm -rf "$1" 2>/dev/null; }

# --- scope classifier for mc-gate ---
# Reads changed file paths, one per line, on stdin. Prints exactly ONE word:
#
#   full    run every check (the safe default)
#   server  only server code changed -> skip the WEB test suite
#   web     only web code changed    -> skip the SERVER test suite
#   docs    only markdown/docs changed -> skip typecheck/lint/build/tests
#
# The whole point is to run LESS only when that is provably safe, so the design
# rule is: anything not clearly docs, server, or web escalates to `full`. A file
# in an unknown location, a dependency manifest, a schema change, or a mix of
# server AND web all resolve to `full`. "When in doubt, run more" is not a hope
# here — it is the default branch of the case below and every fall-through.
#
# It is a pure function of its stdin so it can be tested without a git repo.
mc_classify_files() {
  local has_full=0 has_server=0 has_web=0 has_docs=0 any=0 f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    any=1
    case "$f" in
      # FULL: schema, migrations, any dependency manifest/lockfile, any tsconfig.
      # These can change how EVERYTHING builds or behaves, so they force the whole
      # gate no matter where they live.
      server/prisma/schema.prisma|server/prisma/migrations/*) has_full=1 ;;
      package.json|package-lock.json|*/package.json|*/package-lock.json) has_full=1 ;;
      tsconfig*.json|*/tsconfig*.json) has_full=1 ;;
      # Server code. Checked before the markdown rule on purpose: a server/README.md
      # counts as `server`, not `docs` — over-running is the safe direction.
      server/*) has_server=1 ;;
      # Web code (the Vite SPA). Its own config (vite.config.ts) lives here too and
      # is web-scoped.
      vite/*) has_web=1 ;;
      # Docs: any markdown anywhere, or anything under docs/.
      docs/*|*.md) has_docs=1 ;;
      # Anything else — .github/, firebase/, scripts/, dotfiles, unknown paths —
      # is NOT provably safe to shortcut, so it runs the full gate.
      *) has_full=1 ;;
    esac
  done
  if [ "$any" -eq 0 ]; then echo full; return; fi          # empty diff -> be safe
  if [ "$has_full" -eq 1 ]; then echo full; return; fi
  if [ "$has_server" -eq 1 ] && [ "$has_web" -eq 1 ]; then echo full; return; fi
  if [ "$has_server" -eq 1 ]; then echo server; return; fi
  if [ "$has_web" -eq 1 ]; then echo web; return; fi
  echo docs
}

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
