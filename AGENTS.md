# Project rules (Claude Code) — maincar-2

Read this first. Rules are split across `.claude/rules/` files and loaded automatically by Claude Code when relevant to your work. This file stays focused on cross-cutting rules that apply everywhere.

Layout: `vite/` is the React client, `server/` is the Express API, `firebase/` holds the emulator config, `docker/` holds local Postgres + MinIO. Ports and commands are in [README.md](README.md).

## Rules organized by file

- **Frontend work** → [copy.md](.claude/rules/copy.md), [design-system.md](.claude/rules/design-system.md), [frontend.md](.claude/rules/frontend.md)
- **Server work** → [server-routes.md](.claude/rules/server-routes.md), [database-and-prisma.md](.claude/rules/database-and-prisma.md), [dependencies-and-config.md](.claude/rules/dependencies-and-config.md)
- **Testing** → [testing.md](.claude/rules/testing.md)
- **Committing** → [committing.md](.claude/rules/committing.md)
- **Linear workflow** → [linear-workflow.md](.claude/rules/linear-workflow.md)

## Dates & Times (Timezones)

Every time-of-day shown to a person MUST render in an explicit timezone and carry a zone label (`Jun 24, 2026, 6:00 PM EDT`). Never display a bare local time, and never let formatting fall back to the server's zone.

- **Timezone source**: each user has an IANA `timeZone` on the `User` record, captured at onboarding and defaulted from `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- **Client**: render in the **viewing user's** zone, through helpers in `vite/src/lib/datetime.ts`. Never call `toLocaleString` directly in a component.
- **Server**: render in the **accountable user's** zone, with a documented fallback.
- **Date-only values** render with no time and no zone.
- **An LLM must never invent a timezone.** Hand it a pre-formatted, zone-labeled string and tell it to state that string verbatim.

## AI drafting

**Never let a model draft ahead of its data.** Any value a model states to a user must be known before it drafts—read from the input or handed in through the prompt/tool result. Never compute a user-facing value after the draft and store it without feeding the same value into the draft.

## Git workspaces

**Use one issue clone per issue.** The primary checkout at `~/Documents/Coding/My Projects/maincar-2` is a runnable reference checkout only. Never edit, stage, commit, change branches, merge, or push there. Do not clean, reset, or stash another person's files.

Ticket clones fetch from the local bare mirror. The mirror is a local copy of GitHub's Git history. It rejects direct pushes; `mc-deliver` is the only normal route to GitHub `main`.

```bash
npm run gh-to-mirror
cd ~/code/maincar-2-worktrees
git clone ~/code/maincar-2-coord/local-main.git mai-123-short-title
cd mai-123-short-title
git checkout -b <Linear gitBranchName exactly>
eval "$(./.claude/scripts/coord/mc-slot --env)"
```

Use the scripts documented in [`.claude/scripts/coord/README.md`](.claude/scripts/coord/README.md):

- `mc-gate --focused` runs one named Vitest file through the shared three-job check gate. It uses one test worker.
- `mc-gate --check` runs TypeScript, lint, and the specifically named tests. It uses at most two test workers.
- `mc-deliver enqueue` records one clean committed issue and its specifically named tests in the ready queue.
- `mc-deliver run` takes only the oldest ready issue, merges it onto newest `main` in a temporary clone, checks it, and pushes that exact checked result.
- `mc-doctor` reports locks, queue state, refresh blockers, and machine health.

`mc-train` and `mc-merge` are retired. Do not call raw `git merge` or `git push` as a substitute for `mc-deliver`.

## Small-computer check limits

At most three complete check jobs may run at once across all issue clones. A check job means one invocation of `mc-gate`, not one test file. The limit covers focused tests, commit-time static checks, agent-requested final checks, and delivery checks.

- One named development test uses one Vitest worker.
- TypeScript, lint, final checks, and delivery checks use at most two Vitest workers.
- Three two-worker jobs therefore create no more than six Vitest workers. Other agents, the database, the editor, and the operating system keep the rest of the computer.
- Delivery checks get the next available slot, then commit/final checks, then focused development tests.

Do not run `npm test`, `npm run verify`, whole server/web/integration suites, Playwright, or a manual browser journey as a merge requirement. Name the test files that cover the changed behavior. A database-backed test is allowed when the change actually needs it; name that exact integration test file.

## Required issue completion flow

1. Run named focused tests while implementing:
   `./.claude/scripts/coord/mc-gate --focused -- npm --prefix <server|vite> exec vitest run <file>`.
2. Commit only the issue's files with explicit pathspecs. The pre-commit hook runs TypeScript and lint through the same shared gate.
3. Run a final named check when appropriate. Example:
   `./.claude/scripts/coord/mc-gate --check --test server:src/routes/__tests__/companies.test.ts`.
4. Enqueue the clean commit with those same test files, then run one delivery:
   `./.claude/scripts/coord/mc-deliver enqueue --test server:src/routes/__tests__/companies.test.ts`
   and `./.claude/scripts/coord/mc-deliver run`.
   One run handles one issue only. It uses `git merge --no-ff` in a temporary clone. If the merge or a check fails, that issue returns to its agent without automatic retries or failure-isolation runs. The next queued issue may proceed.
5. Confirm the issue head is reachable from the refreshed local mirror's `main`, and mirror `main` matches upstream `main` at ahead/behind `0/0`.
6. Delete an existing remote feature branch, detach the issue clone at delivered `origin/main`, delete the local feature branch, then remove the clean exact clone directory. Never delete a dirty or unmerged clone.
7. From a surviving checkout, run `mc-closeout MAI-123 --worktree /exact/removed/issue-clone`. Move Linear to Done only when it prints `LINEAR_DONE_ALLOWED`.

Do not call an issue complete after only committing, testing, enqueueing, or opening a PR. GitHub delivery, branch/clone cleanup, closeout proof, and Linear update are required.

## Primary checkout refresh

Every successful delivery attempts `GitHub → local mirror → primary checkout`. A clean, non-divergent primary checkout fast-forwards automatically, even while Maincar processes are running.

Personal uncommitted/untracked work, a non-`main` branch, or a divergent commit blocks the primary refresh without changing it. Active processes do not block the Git fast-forward. If package files or tracked Prisma migrations changed, Git still fast-forwards, but `npm ci` and `prisma migrate deploy` wait until the processes stop. That deferred environment work is durable and always records this exact recovery command:

```bash
npm run mirror-to-main
```

A later delivery checks pending environment work and completes it after the processes stop. Never overwrite or move a person's work automatically.

## Before commit and delivery

- **Red blocks the relevant step.** Static red blocks commit; delivery red blocks delivery.
- **Never skip, delete, or `.skip()` a test to reach green.** Change the code or intentionally change the rule and say so.
- **A feature commit carries its tests**, committed together.
- **If checks could not run**, say so in the commit body and report; silence must never imply green.
- **Browser testing is not required for commit or delivery.** Rely on code checks and specifically named automated tests.

## Money

Never spend the user's money—a paid API call, purchased number, or billed deploy—without asking in the turn the spend would happen. Approval does not carry across turns.
