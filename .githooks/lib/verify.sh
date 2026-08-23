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
# nothing: it drops every fast static check, including the ones that would have
# caught YOUR mistake. A routine, expected condition was therefore forcing a
# total bypass — which is how an unverified commit ships behind a plausible note.
#
# So this splits the verdict by WHOSE file is red:
#
#   * typecheck and lint failures name a file. If none of the named files are in
#     the commit, the failure belongs to another session: warn loudly, record it,
#     and let the commit through.
# Unit and integration tests run only on the combined tree through `mc-train`,
# where they use the bounded worker scheduler and produce one train receipt.
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
