# maincar-2 Coordination Scripts

Seven scripts that let many sessions work on maincar-2 in parallel, one issue per session.

**State location:** `~/code/maincar-2-coord/` (outside the repo, so git never touches it)
**Worktree location:** `~/code/maincar-2-worktrees/` (one folder per issue)
**Scripts location:** `.claude/scripts/coord/` (tracked in the repo)

## Quick start

### 1. Create a worktree for an issue

```bash
cd ~/code/maincar-2-worktrees
git clone /path/to/maincar-2 mai-123-short-title
cd mai-123-short-title
```

### 2. Assign a port slot

```bash
eval "$(./scripts/coord/mc-slot --env)"
# Now your shell has: API_PORT, VITE_PORT, FB_AUTH_PORT, etc.
```

### 3. Run tests with the queue

```bash
./scripts/coord/mc-gate
# Runs: typecheck, lint, build, test, test:integration
# Queues if 4+ are already running
```

Or run specific tests:
```bash
./scripts/coord/mc-gate npm run test:server
```

### 4. Merge safely

```bash
./scripts/coord/mc-merge -m "MAI-123: Your commit message"
# Takes the merge lock
# Checks main hasn't moved since you last rebased
# Merges and pushes
```

### 5. Check health

```bash
./scripts/coord/mc-doctor
# Shows: load, merge lock, stuck worktrees, databases, etc.
```

## The 7 scripts

| Script | What it does | When to use |
| --- | --- | --- |
| `mc-common.sh` | Shared toolbox (lock, log, classify) | Never run directly; sourced by others |
| `mc-slot` | Assigns stable ports for your worktree | `eval "$(mc-slot --env)"` at the start |
| `mc-gate` | Runs tests with a queue (max 4 at once) | Before every merge |
| `mc-merge` | Merges your branch safely, with a lock | When work is done and tests pass |
| `mc-migrate` | Creates non-colliding database migrations | When you need a new migration |
| `mc-doctor` | Shows system health | When something feels stuck |
| `mc-scratch` | Per-worktree temp folder | Rarely used directly |

## How they work together

**Example: One session works on MAI-123**

```bash
# Create worktree
cd ~/code/maincar-2-worktrees
git clone /path/to/maincar-2 mai-123-feature
cd mai-123-feature

# Assign ports (slot 0 = 3010, 5183, 9140, etc.)
eval "$(./scripts/coord/mc-slot --env)"

# Make changes, commit
git checkout -b mai-123-feature
# ... edit code ...
git add file.ts
git commit -m "MAI-123: Feature description"

# Run tests (queued if needed)
./scripts/coord/mc-gate
# [mc-gate] running (slot 1, limit 4)
# ... typecheck, lint, build, tests run ...

# If tests pass, merge
./scripts/coord/mc-merge -m "MAI-123: Feature description"
# [mc-merge] waiting for the merge lock...
# [mc-merge] lock held. Merging mai-123-feature.
# [mc-merge] merged and pushed. mai-123-feature is on main.
```

**Example: Two sessions run in parallel**

```
Session A (MAI-123):
  mc-slot → slot 0 (API 3010, VITE 5183)
  mc-gate → slot 1 (test runner 1)
  mc-gate → done
  mc-merge → gets lock, merges, releases lock

Session B (MAI-124):
  mc-slot → slot 1 (API 3020, VITE 5184)
  mc-gate → slot 2 (test runner 2, slot 1 still running)
  mc-gate → done
  mc-merge → waits for lock (Session A holds it)
           → gets lock after Session A releases it
           → merges
```

No port collisions, no test thrashing, no clobbered merges.

## Configuration

### Limit the number of test runners

```bash
MC_MAX_JOBS=2 mc-gate
# Only 2 tests run at a time (default is 4)
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

## Not using the scripts?

If you prefer to work without worktrees or the queue:
- Work in `/Users/ryanhollander/Documents/Coding/My Projects/maincar-2` directly
- Run `npm run verify` instead of `mc-gate`
- Use `git merge` and `git push` instead of `mc-merge`

The scripts just make parallel safe and fast. Serial work in the main folder still works.
