#!/usr/bin/env bash
#
# Shared by the git hooks in .githooks/. Not run directly.
#
# WHY THIS FILE EXISTS
#
# The commit gate judges the working tree, but this clone normally has more than
# one session editing it at once (see CLAUDE.md → Git and branching). So the gate
# regularly goes red for a half-written file that is not yours.
#
# The only way past a hook is `git commit --no-verify`, and that is all-or-
# nothing: it drops ALL four checks, including the ones that would have caught
# YOUR mistake. A routine, expected condition was therefore forcing a total
# bypass — which is how an unverified commit ships behind a plausible note.
#
# So this splits the verdict by WHOSE file is red:
#
#   * typecheck and lint failures name a file. If none of the named files are in
#     the commit, the failure belongs to another session: warn loudly, record it,
#     and let the commit through.
#   * test failures are NOT reliably attributable to a file — your change can
#     break a test you did not stage. They always block.
#
# `--no-verify` stays for genuine emergencies rather than for Tuesdays.

REPO="$(git rev-parse --show-toplevel)"
STATUS_FILE="$(git rev-parse --git-dir)/VERIFY_STATUS"

# Files this commit actually touches, repo-relative.
staged_files() {
  git diff --cached --name-only --diff-filter=ACMR
}

# Pull repo-relative source paths out of tsc / eslint output.
#
#   tsc:    src/components/GreenRoom.tsx(73,11): error TS6133: ...
#   eslint: /abs/path/to/repo/vite/src/foo.ts   (then indented findings)
#
# $1 is the workspace prefix ("server", "vite") that tsc paths are relative to.
# $2 is the captured output.
#
# Always exits 0. A grep that legitimately matches nothing must not look like a
# failure — under `set -e` that would abort the hook instead of reporting.
failing_files() {
  local prefix="$1" out="$2"
  {
    grep -oE '^[^ (]+\.(ts|tsx|js|jsx|mjs|cts|mts)\([0-9]+,[0-9]+\)' "$out" \
      | sed 's/(.*//' | sed "s|^|$prefix/|" || true
    grep -oE "^${REPO}/[^ :]+\.(ts|tsx|js|jsx|mjs|cts|mts)" "$out" \
      | sed "s|^${REPO}/||" || true
  } | sed 's|^\./||' | sort -u
  return 0
}

# Is any failing file part of this commit?
#
# Exit 0 = yes, the red is YOURS (block). Exit 1 = no, it belongs to someone
# else's in-flight work. An empty failing-file list also returns 0: a failure we
# could not attribute is treated as yours, because guessing in the lenient
# direction is how a gate quietly stops gating.
red_is_ours() {
  local failing="$1"
  [ -s "$failing" ] || return 0
  local staged
  staged="$(staged_files)"
  [ -n "$staged" ] || return 1
  local f
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    if printf '%s\n' "$staged" | grep -qxF -- "$f"; then return 0; fi
  done < "$failing"
  return 1
}

# Could this commit possibly affect workspace $1 ("server" or "vite")?
#
# Test failures cannot be pinned to a file — your change to members.ts can break
# team.test.ts, which you never staged. But they CAN be pinned to a workspace: if
# a commit stages nothing that reaches `vite/`, a vite test failure is not its
# doing. That is a fact about the dependency graph, not a guess.
#
# Shared ground counts as reaching everything: the root package.json, docker/,
# firebase/, scripts/, .env.example. Prose and git hooks reach nothing — no
# vitest run has ever been changed by a markdown file.
#
# Exit 0 = yes, this commit reaches that workspace (its test failures block).
touches_workspace() {
  local ws="$1" f
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      "$ws"/*)                      return 0 ;;
      server/*|vite/*)              continue ;;   # the OTHER workspace
      .claude/*|.githooks/*|docs/*) continue ;;   # inert
      *.md)                         continue ;;   # inert
      *)                            return 0 ;;   # shared ground
    esac
  done < <(staged_files)
  return 1
}

# Print the useful part of a test command's output without changing the hook's
# verdict. A test runner is not required to use any one summary format, so an
# absent match is normal diagnostic output, not a new hook failure.
test_failure_summary() {
  local out="$1" indent="$2" limit="$3"
  local line count=0

  while IFS= read -r line; do
    case "$line" in
      *FAIL*|*'✕'*|*'Test Files'*|*'Tests '*)
        printf '%s%s\n' "$indent" "$line"
        count=$((count + 1))
        [ "$count" -lt "$limit" ] || break
        ;;
    esac
  done < "$out"

  if [ "$count" -eq 0 ]; then
    printf '%s(no recognized test failure summary was emitted)\n' "$indent"
  fi
  return 0
}
