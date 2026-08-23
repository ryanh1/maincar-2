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

Ticket clones fetch from the local bare mirror. The mirror rejects direct pushes; the delivery train is the only production route to GitHub `main`.

```bash
npm run gh-to-mirror
cd ~/code/maincar-2-worktrees
git clone ~/code/maincar-2-coord/local-main.git mai-123-short-title
cd mai-123-short-title
git checkout -b <Linear gitBranchName exactly>
eval "$(./.claude/scripts/coord/mc-slot --env)"
```

Use the scripts documented in [`.claude/scripts/coord/README.md`](.claude/scripts/coord/README.md):

- `mc-gate --focused` runs one named Vitest file through the four-job scheduler. It never runs or reserves Playwright.
- `mc-gate --classify` shows the changed files, suggested risk, and suite scope.
- `mc-train enqueue` records a clean committed head, declared risk, coverage intent, and focused tests in the ordered ready queue.
- `mc-train run` builds compatible entries on the newest mirrored `main`, tests the exact combined tree once, and pushes that tree through a short merge slot.
- `mc-doctor` reports locks, queue state, refresh blockers, and machine health.

`mc-merge` is retired from normal use. Do not manufacture legacy per-session receipts or call raw `git merge`/`git push` as a substitute.

## Risk-based delivery

Every change declares one risk level when it enters the train:

- **Low**: documentation, isolated copy/styling, or a contained client change. The train runs typecheck, lint, and the union of declared focused tests. Non-doc low-risk work must name a focused test.
- **Normal**: ordinary server or client behavior in one suite scope. The train runs typecheck, lint, focused tests, and the relevant server or web suite.
- **High**: migrations, dependencies, auth, permissions, billing, scheduling, shared infrastructure, concurrency, unknown paths, or changes spanning systems. The train runs `npm run verify`, including integration tests, and the entry travels alone.

Path classification is a conservative floor for high-risk work. It cannot be lowered. A contained client change may be explicitly declared low when its coverage note and focused test justify that decision. A group uses the highest declared risk of its members; incompatible suite scopes form separate groups.

The scheduler admits four normal jobs by default, with three real Vitest workers per job inside the measured twelve-worker budget. It reserves no browser workers and the delivery train never runs Playwright.

## Required issue completion flow

1. Run named focused tests while implementing:
   `./.claude/scripts/coord/mc-gate --focused -- npm --prefix <server|vite> exec vitest run <file>`.
2. Commit only the issue's files with explicit pathspecs. The fast pre-commit hook runs attributable typecheck/lint checks; it is not final delivery proof.
3. Inspect `mc-gate --classify`, choose the honest risk, and enqueue the clean commit. Example:
   `./.claude/scripts/coord/mc-train enqueue --risk normal --coverage "company route behavior" --test server:src/routes/__tests__/companies.test.ts`.
4. Run `./.claude/scripts/coord/mc-train run`. It may deliver other explicitly ready compatible entries too. A green train receipt proves the exact combined head, shared-main base, tests, coverage, risk, and members. If isolation reports a failing entry or interaction, fix/re-enqueue it; never push over red.
5. Confirm the issue head is reachable from the refreshed local mirror's `main`, and mirror `main` matches upstream `main` at ahead/behind `0/0`.
6. Delete an existing remote feature branch, detach the issue clone at delivered `origin/main`, delete the local feature branch, then remove the clean exact clone directory. Never delete a dirty or unmerged clone.
7. From a surviving checkout, run `mc-closeout MAI-123 --worktree /exact/removed/issue-clone`. Move Linear to Done only when it prints `LINEAR_DONE_ALLOWED`.

Do not call an issue complete after only committing, testing, enqueueing, or opening a PR. GitHub delivery, branch/clone cleanup, closeout proof, and Linear update are required.

## Primary checkout refresh

Every successful train attempts `GitHub → local mirror → primary checkout`. A clean, idle primary checkout fast-forwards automatically; changed package roots receive `npm ci`, and tracked Prisma migrations receive `prisma migrate deploy`.

Any personal uncommitted/untracked work, non-`main` branch, divergent commit, or active Maincar process blocks the primary refresh without changing it. The blocker is durable and always records this exact recovery command:

```bash
npm run mirror-to-main
```

A later train checks the blocker before delivery and retries only the same safe refresh. Never overwrite or move a person's work automatically.

## Before commit and delivery

- **Red blocks the relevant step.** Static red blocks commit; train red blocks delivery.
- **Never skip, delete, or `.skip()` a test to reach green.** Change the code or intentionally change the rule and say so.
- **A feature commit carries its tests**, committed together.
- **If checks could not run**, say so in the commit body and report; silence must never imply green.
- **User-facing work requires a browser journey.** This coordination workflow itself never adds Playwright to delivery.

## Money

Never spend the user's money—a paid API call, purchased number, or billed deploy—without asking in the turn the spend would happen. Approval does not carry across turns.
