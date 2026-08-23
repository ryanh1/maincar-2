# maincar-2 coordination and simple delivery

The coordination scripts let 10–20 agents work in separate issue clones without making one computer run too many checks at once. Delivery handles one issue at a time.

- State: `~/code/maincar-2-coord/`
- Issue clones: `~/code/maincar-2-worktrees/`
- Local bare mirror: `~/code/maincar-2-coord/local-main.git`
- Durable upstream: GitHub `main`

The primary checkout is a runnable reference copy, never a ticket workspace or Git remote. The bare mirror is the clean local source for every issue clone and rejects direct pushes.

## The four folders that matter

- **Primary checkout:** `~/Documents/Coding/My Projects/maincar-2`. A runnable reference copy. Never edit or commit here.
- **Local mirror:** `~/code/maincar-2-coord/local-main.git`. A bare local copy of GitHub's Git history. It has no editable files and rejects pushes.
- **Issue clone:** one independent editable repository per Linear issue under `~/code/maincar-2-worktrees/`.
- **Temporary delivery clone:** a throwaway clone created by `mc-deliver` to merge and check one issue safely.

We use clones, not Git worktrees. A clone has its own Git data and files, so one agent's branch changes cannot change another agent's folder. The mirror avoids downloading the same history from GitHub 10–20 times. Each synchronization still asks GitHub for anything new, but new issue clones copy most data locally.

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

At most three complete `mc-gate` jobs run at once across every clone. A job is one whole check request. A focused single-file test uses one Vitest worker. Static, final, and delivery checks use at most two workers. Therefore the busiest allowed test load is six Vitest workers. Delivery waits have first priority, then commit/final checks, then focused development checks.

The gate is used for intermediate checks and final checks. It does not make three sessions share one test. It lets up to three sessions each run their own whole check while holding the computer-wide limit.

## Enqueue a committed head

```bash
./.claude/scripts/coord/mc-deliver enqueue \
  --test server:src/routes/__tests__/companies.test.ts
```

Requirements:

- clean committed non-`main` branch;
- branch name contains the Linear issue key;
- every named test exists in the committed head.

`enqueue` records the issue, exact commit, branch, clone, starting `main`, and named tests. This information lives in the local queue files, not in chat and not in a commit comment. Moving the branch after enqueue makes the old entry unusable; enqueue the new commit.

View the queue:

```bash
./.claude/scripts/coord/mc-deliver status
```

## Deliver one issue

```bash
./.claude/scripts/coord/mc-deliver run
```

One run does exactly this:

1. Copies newest GitHub `main` into the local mirror.
2. Takes the oldest ready issue only.
3. Makes a temporary clone from the mirror.
4. Fetches the issue's exact commit from its issue clone.
5. Runs `git merge --no-ff` to combine that issue with newest `main`. This makes a merge commit and does not rewrite the issue's commits.
6. Runs TypeScript, lint, and only the specifically named unit or database integration test files. It does not run a browser or a complete server, web, or integration suite.
7. Briefly locks the GitHub update, confirms `main` did not change during the checks, and pushes the exact checked result.
8. Synchronizes the mirror again and safely tries to refresh the primary checkout.

If GitHub `main` changed while checks ran, the issue stays ready. A later run rebuilds it from the newer `main` and checks it again. Tests never run while the short GitHub-update lock is held.

## A failed issue

No red issue is pushed. A merge conflict, setup failure, or red check moves that one issue out of the ready queue and records one plain failure reason. There are no automatic retries, isolation runs, pair tests, grouping, or risk classification. The issue's agent fixes it and enqueues a new commit. The next ready issue can proceed immediately.

## Primary checkout refresh

Two explicit npm commands make direction clear:

```bash
npm run gh-to-mirror
npm run mirror-to-main
```

After every green delivery, `mc-deliver` automatically attempts the full chain. A clean, idle primary checkout fast-forwards. Changed package roots receive `npm ci`; tracked Prisma schema/migrations receive `prisma migrate deploy`.

The refresh changes nothing when any of these is true:

- personal staged, unstaged, or untracked work exists;
- the primary checkout is not on `main`;
- local `main` contains a commit absent from delivered `main`;
- a Maincar process whose working directory is the primary checkout is listening on a project port.

Every block writes `state/primary-refresh-pending.tsv`, prints a plain reason, and records the exact follow-up command `npm run mirror-to-main`. `mc-doctor` stays nonzero until the blocker is reconciled. A later delivery checks and retries the blocker but never moves or overwrites personal work.

Manual refresh has the same safety checks as automatic refresh. The difference is timing: automatic refresh happens immediately after delivery only when the primary checkout is safe; manual refresh lets a person first finish, commit, or remove whatever caused the block. Neither form overwrites personal files.

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
| `mc-common.sh` | Shared locks, mirror, safe primary refresh, small delivery record |
| `mc-local-main` | GitHub → mirror sync and explicit mirror → primary refresh |
| `mc-slot` | Stable per-clone ports |
| `mc-gate` | Three-job check scheduler with one or two test workers per job |
| `mc-deliver` | Ordered queue and one-issue delivery |
| `mc-closeout` | GitHub/clone proof before Linear Done |
| `mc-migrate` | Non-colliding Prisma migration authoring |
| `mc-doctor` | Machine, queue, lock, mirror, and refresh health |
| `mc-scratch` | Per-clone temporary directory |

`mc-train` and `mc-merge` are retired compatibility shims and always exit.
