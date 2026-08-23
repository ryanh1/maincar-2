# maincar-2 Coordination Scripts

Eight scripts that let many sessions work on maincar-2 in parallel, one issue per session.

**State location:** `~/code/maincar-2-coord/` (outside the repo, so git never touches it)
**Worktree location:** `~/code/maincar-2-worktrees/` (one folder per issue)
**Scripts location:** `.claude/scripts/coord/` (tracked in the repo)

Ticket checkouts fetch from a local bare mirror. The primary checkout is never a
remote: it can contain a person's unfinished files, while a bare mirror cannot.
`mc-merge` refreshes the mirror from GitHub under its merge lock and refreshes it
again after pushing, so tickets retain a local fetch source without inheriting
the primary checkout's state. The mirror rejects every push; only `mc-merge`
may deliver to GitHub under the merge lock. After a successful delivery,
`mc-merge` fast-forwards the runnable primary checkout from the refreshed mirror
when it is already on `main` and local changes cannot be overwritten. Unrelated
untracked files stay in place; only a path collision blocks the refresh. If a
refresh is unsafe or requires dependency/Prisma provisioning, it leaves a durable
`REFRESH REQUIRED` receipt and `mc-doctor` exits nonzero until reconciliation.

Running `mc-local-main sync` also installs hard-block hooks in the primary
checkout, so a commit or push there fails immediately.

When delivery changes a package manifest, lockfile, Prisma schema, or tracked
Prisma migration, `mc-merge` deliberately does not refresh the runnable primary
checkout: advancing source before its local dependencies or database are ready
can break a live dev server. Refresh it explicitly instead; this fast-forwards
only when safe, then runs `npm ci` for affected package roots and applies tracked
Prisma migrations:

```bash
./.claude/scripts/coord/mc-local-main refresh
```

## Quick start

### 1. Create a worktree for an issue

```bash
./.claude/scripts/coord/mc-local-main sync
cd ~/code/maincar-2-worktrees
git clone ~/code/maincar-2-coord/local-main.git mai-123-short-title
cd mai-123-short-title
```

### 2. Assign a port slot

```bash
eval "$(./.claude/scripts/coord/mc-slot --env)"
# Now your shell has: API_PORT, VITE_PORT, FB_AUTH_PORT, etc.
```

### 3. Run tests with the queue

```bash
./.claude/scripts/coord/mc-gate
# Runs: typecheck, lint, build, test, test:integration
# Queues if 4+ are already running
```

Or run specific tests:
```bash
./.claude/scripts/coord/mc-gate npm run test:server
```

### 4. Merge safely

```bash
./.claude/scripts/coord/mc-merge --gate -m "MAI-123: Your commit message"
# Takes the merge lock
# Checks main hasn't moved since you last rebased
# Merges and pushes, refreshes the mirror, then refreshes the runnable checkout when safe
```

### 5. Prove closeout, then update Linear

```bash
# Run this from a surviving checkout after the issue clone directory is gone.
./.claude/scripts/coord/mc-closeout MAI-123 --worktree ~/code/maincar-2-worktrees/mai-123-feature
# Only after it prints LINEAR_DONE_ALLOWED: move MAI-123 to Done in Linear.
```

### 6. Check health

```bash
./.claude/scripts/coord/mc-doctor
# Shows: load, merge lock, stuck worktrees, databases, etc.
```

## The 8 scripts

| Script | What it does | When to use |
| --- | --- | --- |
| `mc-common.sh` | Shared toolbox (lock, log, local-mirror sync) | Never run directly; sourced by others |
| `mc-local-main` | Creates/refreshes the local bare `main` mirror; `refresh` also safely updates the runnable primary checkout and changed dependencies | Before creating ticket clones; use `refresh` after a dependency-changing delivery |
| `mc-slot` | Assigns stable ports for your worktree | `eval "$(mc-slot --env)"` at the start |
| `mc-gate` | Runs tests with a serial queue by default | Before every merge |
| `mc-merge` | Merges your branch safely, with a lock | When work is done and tests pass |
| `mc-closeout` | Proves GitHub delivery and clone cleanup | Immediately before Linear Done |
| `mc-migrate` | Creates non-colliding database migrations | When you need a new migration |
| `mc-doctor` | Shows system health | When something feels stuck |
| `mc-scratch` | Per-worktree temp folder | Rarely used directly |

## How they work together

**Example: One session works on MAI-123**

```bash
# Create worktree
./.claude/scripts/coord/mc-local-main sync
cd ~/code/maincar-2-worktrees
git clone ~/code/maincar-2-coord/local-main.git mai-123-feature
cd mai-123-feature

# Assign ports (slot 0 = 3010, 5183, 9140, etc.)
eval "$(./.claude/scripts/coord/mc-slot --env)"

# Make changes, commit
git checkout -b mai-123-feature
# ... edit code ...
git add file.ts
git commit -m "MAI-123: Feature description"

# Run tests (queued if needed)
./.claude/scripts/coord/mc-gate
# [mc-gate] running (slot 1, limit 1)
# ... typecheck, lint, build, tests run ...

# If tests pass, merge
./.claude/scripts/coord/mc-merge --gate -m "MAI-123: Feature description"
# [mc-merge] waiting for the merge lock...
# [mc-merge] lock held. Merging mai-123-feature.
# [mc-merge] merged and pushed. mai-123-feature is on main.
```

**Example: Two sessions use the queue**

```
Session A (MAI-123):
  mc-slot → slot 0 (API 3010, VITE 5183)
  mc-gate → slot 1 (test runner 1)
  mc-gate → done
  mc-merge → gets lock, merges, releases lock

Session B (MAI-124):
  mc-slot → slot 1 (API 3020, VITE 5184)
  mc-gate → waits for Session A's test runner
  mc-gate → slot 1 after Session A finishes
  mc-merge → waits for lock (Session A holds it)
           → gets lock after Session A releases it
           → merges
```

No port collisions, no test thrashing, no clobbered merges. Full gates run
serially by default because their parallel workers can already saturate a
development machine.

## Configuration

### Limit the number of test runners

```bash
MC_MAX_JOBS=2 mc-gate
# Deliberately allow 2 tests at a time (default is 1)
```

### Force full gate (skip scope detection)

```bash
MC_GATE_FULL=1 mc-gate
# Runs typecheck/lint/build/tests even if only docs changed
```

### Use a different database container

```bash
MC_PG_CONTAINER=my-postgres mc-migrate add_column
```

### Use a different state directory

```bash
MC_STATE_HOME=~/my-coord-state mc-slot
```

## Troubleshooting

**"mc-merge: merge lock busy for 30 min"**
→ Another session is stuck. Run `mc-doctor` to see who holds it.

**"mc-gate FAILED rc=X"**
→ Run the failing check locally to debug (tests under load fail at random without the queue).

**"Could not create throwaway database"**
→ Docker or Postgres is not running. Run `npm run docker:up`.

**Leftover test databases accumulating**
→ Check `mc-doctor`. A stale migration or database issue. Usually harmless.

## Required delivery workflow

The coordination scripts are not optional for a feature branch's closeout:

1. Run focused tests during implementation, then `MC_GATE_FULL=1
   ./.claude/scripts/coord/mc-gate` before committing.
2. Commit the feature with its tests.
3. Run `./.claude/scripts/coord/mc-merge --gate -m "MAI-123: ..."`; it is the
   only supported merge-and-push route to `main`.
4. Confirm `main` and `origin/main` are at ahead/behind `0/0`.
5. Delete the merged feature branch (including an existing remote branch), then
   remove the clean, exact feature worktree and confirm `git worktree list` is
   free of stale entries.
6. Update the Linear issue after those delivery and cleanup receipts exist.

Do not replace `mc-merge` with raw `git merge` or a direct push to `main`.
