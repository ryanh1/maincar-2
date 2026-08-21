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

**Use a worktree per issue.** Multiple sessions work this repo at once. Give each
one its own checkout and branch instead of sharing the main tree:

```bash
cd ~/code/maincar-2-worktrees
git clone /path/to/maincar-2 mai-123-short-title
cd mai-123-short-title
git checkout -b mai-123-short-title
```

Then use the coordination scripts in [`.claude/scripts/coord/`](.claude/scripts/coord/README.md)
(full picture in its README):

- `eval "$(./scripts/coord/mc-slot --env)"` — stable ports for this worktree; no
  collisions with other sessions' dev servers.
- `./scripts/coord/mc-gate` — run the test gate through a shared queue instead of
  calling `npm run verify` directly. It still runs everything `verify` runs — it is
  a queue, not a shortcut.
- `./scripts/coord/mc-merge -m "MAI-123: ..."` — merge and push under a lock, so
  two sessions can't push over each other.
- `./scripts/coord/mc-doctor` — check machine health (stuck locks, load, leftover
  test databases) if something feels stuck.

**No worktree, or working solo in the main checkout?** That still works:

- Preserve all existing changes. Make your changes, then commit only the files and
  hunks you changed — `git commit -- <paths>`, never a bare `git add -A` (see
  [committing.md](.claude/rules/committing.md) → **The index is shared**).
- Do not touch, revert, stash, or commit another session's changes.
- Run `npm run verify` yourself instead of `mc-gate`, and `git merge`/`git push`
  instead of `mc-merge`.

## Before you commit

**Green tests are the gate.** Run this at the repo root, and read the output, before every `git commit` and every `git push`:

```bash
npm run verify
```

That is `typecheck`, `lint`, `test`, and `test:integration`. **The integration suite is part of the gate, not an extra** — `npm test` does not include it, and it holds the only tests that prove the concurrency guardrails. It needs Postgres, so run `npm run docker:up` first.

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
