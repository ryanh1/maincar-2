# Project rules (Claude Code) — maincar-2

Read this first. Rules are split across `.claude/rules/` files and loaded automatically by Claude Code when relevant to your work. This file stays focused on cross-cutting rules that apply everywhere.

Layout: `vite/` is the React client, `server/` is the Express API, `firebase/` holds the emulator config, `docker/` holds local Postgres + MinIO. Ports and commands are in [README.md](README.md).

## Rules organized by file

Claude Code auto-loads the rules for what you're touching.

- **Frontend work** → [copy.md](.claude/rules/copy.md), [design-system.md](.claude/rules/design-system.md), [frontend.md](.claude/rules/frontend.md)
- **Server work** → [server-routes.md](.claude/rules/server-routes.md), [database-and-prisma.md](.claude/rules/database-and-prisma.md), [dependencies-and-config.md](.claude/rules/dependencies-and-config.md)
- **Testing** → [testing.md](.claude/rules/testing.md)
- **Committing** → [committing.md](.claude/rules/committing.md) — the gate, the hook, bypasses
- **Linear workflow** → [linear-workflow.md](.claude/rules/linear-workflow.md) — Issue status transitions, commit messages, branching

## Dates & Times (Timezones)

Every time-of-day shown to a person MUST render in an explicit timezone and carry a zone label (`Jun 24, 2026, 6:00 PM EDT`). Never display a bare local time, and never let formatting fall back to the server's zone.

- **Timezone source**: each user has an IANA `timeZone` on the `User` record, captured at onboarding and defaulted from `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- **Client**: render in the **viewing user's** zone, through helpers in `vite/src/lib/datetime.ts`. Never call `toLocaleString` directly in a component.
- **Server**: render in the **accountable user's** zone, with a documented fallback.
- **Date-only values** (a calendar date with no time) render with no time and no zone.
- **An LLM must never invent a timezone.** Hand it a pre-formatted string with the zone label already in it, and tell it to state that string verbatim.

## AI drafting

**Never let a model draft ahead of its data.** Any value a model states to a user must be known to it *before* it drafts — read from the input, or handed in via the prompt or a tool result. Never compute a user-facing value *after* the draft and store it without feeding the SAME value into the draft, or the text and the stored record disagree.

## Git and branching

**Use an issue clone per issue.** Multiple sessions work this repo at once. The
primary checkout at `~/Documents/Coding/My Projects/maincar-2` is a reference
checkout only: **never edit, stage, commit, change branches, merge, or push in
it directly.** The sole exception is `mc-merge`'s automatic safe refresh after
GitHub accepts delivery: it fast-forwards `main` from the refreshed bare mirror
only when no local work would be overwritten. A hook and every other `mc-*`
delivery command reject it. If it is dirty, do not clean, reset, or stash it:
identify the owner and move that work into an issue clone. Run
`./.claude/scripts/coord/mc-doctor` when something looks stale.

Ticket clones fetch from a local *bare* mirror, not the editable primary
checkout. This keeps local fetches fast without allowing one session's WIP to
block another session's delivery. The mirror rejects direct pushes, so
`mc-merge` is the only normal delivery route.

```bash
./.claude/scripts/coord/mc-local-main sync
cd ~/code/maincar-2-worktrees
git clone ~/code/maincar-2-coord/local-main.git mai-123-short-title
cd mai-123-short-title
git checkout -b mai-123-short-title
```

Then use the coordination scripts in [`.claude/scripts/coord/`](.claude/scripts/coord/README.md)
(full picture in its README):

- `eval "$(./.claude/scripts/coord/mc-slot --env)"` — stable ports for this worktree; no
  collisions with other sessions' dev servers.
- `./.claude/scripts/coord/mc-gate --focused -- npm --prefix vite exec vitest run path/to/file.test.tsx`
  — run one named development test through the bounded focused lane. Arbitrary
  commands and broad suites cannot claim this lane.
- `./.claude/scripts/coord/mc-gate --delivery` — run the full delivery gate through
  the shared scheduler instead of calling `npm run verify` directly. It runs the
  same checks, caps framework workers, and is the only manual full-suite command.
- `./.claude/scripts/coord/mc-merge -m "MAI-123: ..."` — after a fresh delivery
  receipt exists, briefly locks, rechecks that exact branch-head/main pair, then
  merges and pushes. It never runs tests while holding the merge lock.
- `./.claude/scripts/coord/mc-doctor` — check machine health (stuck locks, load, leftover
  test databases) if something feels stuck.

### Required issue completion flow

For every implementation branch, finish the whole sequence before reporting the
issue done:

1. Run a named focused test while implementing. Focused checks never satisfy
   the full delivery requirement.
2. Commit only the feature's own files, using explicit pathspecs.
3. Sync and rebase outside the merge lock, then create the full-gate receipt:
   `./.claude/scripts/coord/mc-local-main sync && git fetch origin && git rebase origin/main && ./.claude/scripts/coord/mc-gate --delivery`.
4. Run `./.claude/scripts/coord/mc-merge -m "MAI-123: ..."`. This is the only
   permitted route to `main`: it rechecks the receipt under a short lock, then
   creates the merge commit and pushes `main` to GitHub. If `main` moves, rebase
   and rerun the delivery gate; never test while holding the merge lock.
5. Confirm `main` and `origin/main` have ahead/behind `0/0` after the push.
6. Delete the feature branch after its head is on `origin/main`. Delete a remote
   feature branch if one exists, and delete its local branch. Then remove its
   clean, exact worktree directory and confirm `git worktree list` has no stale
   registrations. Never delete a dirty or unmerged worktree.
7. From a surviving checkout, run
   `./.claude/scripts/coord/mc-closeout MAI-123 --worktree /exact/removed/issue-clone`.
   Update Linear to Done only when it prints `LINEAR_DONE_ALLOWED`; see
   [linear-workflow.md](.claude/rules/linear-workflow.md).

Do not call an issue complete after only committing, testing, or opening a PR.
The merge, GitHub push, branch deletion, worktree deletion, and Linear update are
all required closeout steps.

There is no solo-main exception. If you started in the primary checkout, create
an issue clone before editing. Preserve any existing primary-checkout files;
never reset, stash, revert, commit, or "clean up" another session's work.

## Before you commit

**Green tests are the gate.** The pre-commit hook remains the immediate commit
backstop. After committing and rebasing, run this at the repo root to create the
exact receipt required before every delivery:

```bash
./.claude/scripts/coord/mc-gate --delivery
```

That schedules `typecheck`, `lint`, `test`, and `test:integration` with at most
two delivery gates and a 12-worker framework budget, reserving six workers for
the system, and records the tested committed HEAD plus `origin/main` base. The
merge script rejects a missing or stale receipt. **The integration suite is part
of the gate, not an extra** — `npm test` does not include it, and it holds the
only tests that prove the concurrency guardrails. It needs Postgres, so run
`npm run docker:up` first.

- **Red blocks the commit.** Fix it, or stop and report exactly what is broken. Never commit or push over it.
- **Another session's red is not your red.** The `pre-commit` hook already tells them apart, so you do not need `--no-verify` for a file you did not write. See [committing.md](.claude/rules/committing.md).
- **Never skip, delete, or `.skip()` a test to reach green.** Change the code, or change the rule on purpose and say so.
- **A feature commit carries its own tests**, committed together, never as a follow-up. **That holds even when the files you touched do not load [testing.md](.claude/rules/testing.md).**
- **If you could not run the checks**, say so in your report and in the commit message body. Never let silence imply they passed.

Mechanics, the hook, and the `Verified-by:` trailer: [committing.md](.claude/rules/committing.md).

## Verification before finishing

- **After editing UI**, run `npm run typecheck` and `npm run lint` at the repo root. TypeScript does not always report an undefined JSX component; the build does.
- **Run `npm test`** before calling anything done, and again before you commit — see [Before you commit](#before-you-commit).
- **Walk the journey in a browser** for anything user-facing. Parts passing in isolation is not evidence the journey works. A route path is a string, so `tsc` cannot verify a rename — click it.
- **Never leave a feature half-wired.** If a control cannot be finished, do not render it, or render it visibly disabled with an honest label. Never ship a live-looking control that does nothing.
- **Report what you could not verify**, at the step where it applies.

## Money

Never spend the user's money — a paid API call, a purchased phone number, a deploy that bills — without asking **in the turn the spend would happen**. A plan that mentions a purchase is not consent, and approval does not carry across turns.
