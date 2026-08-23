# maincar-2 coordination and delivery train

The coordination scripts let many issue clones develop and test concurrently while one local train delivers compatible ready changes together.

- State: `~/code/maincar-2-coord/`
- Issue clones: `~/code/maincar-2-worktrees/`
- Local bare mirror: `~/code/maincar-2-coord/local-main.git`
- Durable upstream: GitHub `main`

The primary checkout is a runnable reference copy, never a ticket workspace or Git remote. The bare mirror is the clean local source for every issue clone and rejects direct pushes.

## Delivery model

```text
committed issue heads
        ↓ ordered enqueue
compatible ready group + newest mirrored main
        ↓ one risk-based test plan
exact tested train head
        ↓ short protected base recheck + push
GitHub → local mirror → clean, idle primary checkout
```

Expensive tests never run while the merge lock is held. The short final slot checks that mirrored `main` still equals the train's tested base and pushes the exact tested head.

The temporary train tree links the issue clone's ignored `.env`, or the primary checkout's ignored `.env` as a fallback, so database-backed verification uses the existing local test environment. Environment values are never copied into Git or written to train receipts.

## Start an issue

```bash
npm run gh-to-mirror
cd ~/code/maincar-2-worktrees
git clone ~/code/maincar-2-coord/local-main.git mai-123-short-title
cd mai-123-short-title
git checkout -b <Linear gitBranchName exactly>
eval "$(./.claude/scripts/coord/mc-slot --env)"
npm run hooks:install
```

Use one clone per issue. Never edit or commit in the normal `maincar-2` folder.

## Develop with focused tests

```bash
./.claude/scripts/coord/mc-gate --focused -- \
  npm --prefix server exec vitest run src/routes/__tests__/companies.test.ts
```

The focused lane accepts exactly one named Vitest file in `server` or `vite`. It rejects broad commands and Playwright.

The scheduler admits four normal jobs by default. A train job is budgeted as three real Vitest workers; a focused job uses one. Four train jobs fit inside the measured twelve-worker capacity. No browser workers are reserved because neither lane runs Playwright.

Protected scheduler defaults are:

```text
machine workers: 18
system reserve: 6
job limit: 4
Vitest workers per train job: 3
```

An exceptional override requires `MC_GATE_OVERRIDE=1`; invalid worker math is rejected.

## Inspect and declare risk

```bash
./.claude/scripts/coord/mc-gate --classify
```

The classifier prints changed files, suggested risk, and suite scope. It is a conservative floor for high-risk paths, not a replacement for judgment.

| Risk | Examples | Combined train checks |
| --- | --- | --- |
| Low | Docs, isolated copy/styling, contained client UI | typecheck, lint, declared focused tests |
| Normal | Ordinary server or client behavior in one suite | low checks plus `test:server` or `test:web` |
| High | Migrations, packages, auth, permissions, billing, scheduling, shared infrastructure, concurrency, cross-system/unknown paths | full `npm run verify`, including integration |

High-risk entries travel alone. Docs can join either a server or client group. Server and client behavior form separate normal groups so a group never silently becomes a cross-system change. A contained client entry can be explicitly declared low only with a focused test and coverage note. A high-risk floor cannot be lowered.

## Enqueue a committed head

```bash
./.claude/scripts/coord/mc-train enqueue \
  --risk normal \
  --coverage "company route behavior and validation" \
  --test server:src/routes/__tests__/companies.test.ts
```

Requirements:

- clean committed non-`main` branch;
- branch name contains the Linear issue key;
- one-line coverage note;
- every named focused test exists in the committed head;
- honest declared risk at or above mandatory high-risk floors.

`enqueue` records an immutable head, its merge base, issue, branch, worktree, declared/suggested risk, scope, coverage, tests, and a monotonic sequence in the shared ready queue. Moving the branch after enqueue supersedes that entry; enqueue the new head explicitly.

View the queue:

```bash
./.claude/scripts/coord/mc-train status
```

## Run the train

```bash
./.claude/scripts/coord/mc-train run
```

The conductor:

1. Checks any durable primary-refresh blocker and retries only the same safe refresh.
2. Copies the newest GitHub `main` into the local mirror.
3. Reads ready entries in sequence order.
4. Merges the largest compatible group onto that exact base; high-risk work is one entry.
5. Reuses unchanged local dependencies or installs changed lockfiles in the private train checkout.
6. Runs the group's highest risk plan once and records each command, coverage intent, base, tested head, risk, scope, and members.
7. Under the short merge lock, rechecks the base and pushes the exact tested tree.
8. Refreshes GitHub → mirror → primary checkout and records a delivery receipt for every member.

If another non-train process advances `main`, the short slot refuses the stale train and leaves its members ready. It never reruns tests under the lock.

## Failed groups

No red group is pushed. The conductor rebuilds each entry alone. If entries pass alone, it tests pairs to identify a semantic interaction. It moves the proven failing entry or interaction subset to `state/train/failed/<run>/`, writes `failure.txt`, and leaves unrelated ready entries queued.

Merge conflicts are compatibility failures. An entry that conflicts with the newest main is recorded as failed; an entry that only conflicts with an earlier group member waits for the next train rather than blocking the compatible prefix.

## Primary checkout refresh

Two explicit npm commands make direction clear:

```bash
npm run gh-to-mirror
npm run mirror-to-main
```

After every green delivery, the train automatically attempts the full chain. A clean, idle primary checkout fast-forwards. Changed package roots receive `npm ci`; tracked Prisma schema/migrations receive `prisma migrate deploy`.

The refresh changes nothing when any of these is true:

- personal staged, unstaged, or untracked work exists;
- the primary checkout is not on `main`;
- local `main` contains a commit absent from delivered `main`;
- a Maincar process whose working directory is the primary checkout is listening on a project port.

Every block writes `state/primary-refresh-pending.tsv`, prints a plain reason, and records the exact follow-up command `npm run mirror-to-main`. `mc-doctor` stays nonzero until the blocker is reconciled. A later train checks and retries the blocker but never moves or overwrites personal work.

## Close out an issue

After the issue's delivery receipt exists:

1. Confirm the issue head is an ancestor of mirrored `main` and mirror/upstream are `0/0` ahead/behind.
2. Delete any remote feature branch.
3. Detach the issue clone at delivered `origin/main`, delete the local feature branch, and remove the clean exact clone directory.
4. From a surviving checkout, run:

```bash
./.claude/scripts/coord/mc-closeout MAI-123 \
  --worktree ~/code/maincar-2-worktrees/mai-123-short-title
```

Move Linear to Done only after `LINEAR_DONE_ALLOWED` prints.

## Script reference

| Script | Purpose |
| --- | --- |
| `mc-common.sh` | Shared locks, mirror, refresh, risk, receipts |
| `mc-local-main` | GitHub → mirror sync and explicit mirror → primary refresh |
| `mc-slot` | Stable per-clone ports |
| `mc-gate` | Four-job focused/risk scheduler |
| `mc-train` | Ordered enqueue, grouping, combined test, isolation, delivery |
| `mc-closeout` | GitHub/clone proof before Linear Done |
| `mc-migrate` | Non-colliding Prisma migration authoring |
| `mc-doctor` | Machine, queue, lock, mirror, and refresh health |
| `mc-scratch` | Per-clone temporary directory |

`mc-merge` is a retired compatibility shim and always exits. The historical implementation lives only under `tests/fixtures/` for pre-train regression coverage.
