# Committing and delivery proof

The short version lives in [AGENTS.md](../../AGENTS.md). This file holds the mechanics.

## Fast commit hook

`.githooks/pre-commit` runs attributable server/client typecheck and lint checks. It never starts unit tests, integration tests, Docker, or a delivery gate. Install it once per clone:

```bash
npm run hooks:install
```

The hook is a quick backstop, not delivery proof. Unit and integration work belongs to the post-commit train, where compatible committed heads are tested together once.

If a static failure names a file in this commit, the hook blocks. A failure only in another session's file is recorded as degraded and does not force `--no-verify`. An unattributable failure counts as this commit's failure.

`.githooks/prepare-commit-msg` appends a `Verified-by:` trailer only when static checks were degraded or bypassed. No trailer means the fast static hook passed; it never means the change was delivered.

`git commit --no-verify` is for a genuine emergency. If used, say why in the commit body and user report, and name what did run.

## Focused development tests

Run one named Vitest file through the bounded lane while implementing:

```bash
./.claude/scripts/coord/mc-gate --focused -- npm --prefix server exec vitest run src/routes/__tests__/companies.test.ts
```

Focused tests provide development feedback. They do not create per-session delivery receipts and cannot authorize a push.

## Train delivery proof

After committing, inspect the classifier and declare the honest risk:

```bash
./.claude/scripts/coord/mc-gate --classify
./.claude/scripts/coord/mc-train enqueue --risk normal \
  --coverage "company route behavior" \
  --test server:src/routes/__tests__/companies.test.ts
./.claude/scripts/coord/mc-train run
```

The train builds compatible ready heads on the newest mirrored `main`, runs one combined risk plan, records the shared-main base and tested head, and pushes that exact tree through the short merge slot. A main advance is checked only in the final slot; no full suite runs there.

- **Low**: typecheck, lint, declared focused tests.
- **Normal**: low checks plus the relevant server or web suite.
- **High**: full `npm run verify`, including integration, and travels alone.

A combined failure triggers isolated single-entry checks and then pair checks when needed. Independent failures and semantic interactions are recorded; no member of the failing subset is delivered.

## Commit scope

Always commit by explicit pathspec so only the issue's files enter the commit:

```bash
git commit -m "MAI-123: Describe the change" -- path/one path/two
```

- Stage and commit only the issue's files.
- Never reset or stash to tidy shared state.
- Never skip/delete tests to manufacture green.
- Feature code and its tests ship in the same commit.
