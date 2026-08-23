# Committing and delivery proof

The short version lives in [AGENTS.md](../../AGENTS.md). This file holds the mechanics.

## Fast commit hook

`.githooks/pre-commit` runs TypeScript and lint through the shared three-job check gate. It never starts unit tests, integration tests, Docker, or browser tests. Install it once per clone:

```bash
npm run hooks:install
```

The hook is a quick backstop, not delivery proof. It waits when three other check jobs are already running. Any TypeScript or lint failure blocks the commit because every issue has an independent clone; another session cannot change files in this clone.

`.githooks/prepare-commit-msg` appends a `Verified-by:` trailer only when the hook was bypassed. No trailer means the static hook passed; it never means the change was delivered.

`git commit --no-verify` is for a genuine emergency. If used, say why in the commit body and user report, and name what did run.

## Focused development tests

Run one named Vitest file through the bounded lane while implementing:

```bash
./.claude/scripts/coord/mc-gate --focused -- npm --prefix server exec vitest run src/routes/__tests__/companies.test.ts
```

Focused tests provide development feedback. Run a final check with the exact relevant files before delivery when appropriate:

```bash
./.claude/scripts/coord/mc-gate --check \
  --test server:src/routes/__tests__/companies.test.ts
```

## One-issue delivery

After committing, enqueue the exact commit and name the tests that cover it:

```bash
./.claude/scripts/coord/mc-deliver enqueue \
  --test server:src/routes/__tests__/companies.test.ts
./.claude/scripts/coord/mc-deliver run
```

One `run` handles the oldest ready issue only. It copies newest `main` into a temporary clone, merges that issue with `git merge --no-ff`, runs TypeScript, lint, and only the named tests, and pushes the exact checked result. It never runs a browser or a whole server/web/integration suite.

If the merge or a check fails, the issue is removed from the ready queue and returned to its agent. There are no automatic retries, solo reruns, pair tests, risk levels, or combined batches. The next queued issue may proceed.

## Commit scope

Always commit by explicit pathspec so only the issue's files enter the commit:

```bash
git commit -m "MAI-123: Describe the change" -- path/one path/two
```

- Stage and commit only the issue's files.
- Never reset or stash to tidy shared state.
- Never skip/delete tests to manufacture green.
- Feature code and its tests ship in the same commit.
