# Committing

The short version lives in [CLAUDE.md](../../CLAUDE.md) → **Before you commit**, because a
path-gated rule file goes unread on work that touches neither `server/**` nor
`vite/src/**`. This file holds the mechanics.

## The gate

```bash
./.claude/scripts/coord/mc-gate --delivery
```

Four checks: `typecheck`, `lint`, `test`, `test:integration`. This full suite
must enter the delivery lane; do not run `npm run verify` directly while sharing
the machine with other sessions.

**The integration suite is part of the gate, not an extra.** `npm test` does not
include it, and it holds the only tests that prove the concurrency guardrails —
that two admins cannot both demote each other and leave an org with zero admins.
That guardrail was genuinely broken when first written, so this is not
hypothetical. It needs Postgres: `npm run docker:up`.

## The hook

`.githooks/pre-commit` runs only the attributable static checks (`typecheck`
and `lint`) and refuses a red commit. It intentionally never starts unit tests,
integration tests, or Docker: those full suites must run once through the
post-commit delivery gate above. Install once per clone:

```bash
npm run hooks:install
```

The hook is the immediate static-check backstop. After committing, sync and
rebase onto current `origin/main`, then run the delivery gate to create the
receipt that authorizes `mc-merge`. A green pre-commit hook alone cannot
authorize delivery because it runs neither the full suite nor the final commit
and rebase.

## Another session's red is not your red

This clone normally has more than one session editing it at once (CLAUDE.md →
**Git and branching**), so the working tree regularly goes red on a half-written
file that is not yours. The hook handles that itself:

| Check | Names a file? | On failure |
| -- | -- | -- |
| typecheck | yes | Blocks only if a failing file is in **your** commit. Otherwise warns, names the foreign files, and lets you through. |
| lint | yes | Same. |

Unit and integration test failures are evaluated by `mc-gate --delivery`, not
by the hook. This keeps every full suite within the shared delivery lanes and
worker budget.

A failure whose file cannot be determined counts as yours. Guessing in the
lenient direction is how a gate quietly stops gating.

**So you do not need `--no-verify` for someone else's unfinished work.** That was
the old failure mode: the only escape hatch was all-or-nothing, so a routine
condition forced a total bypass, and the commit shipped with its static checks
skipped behind a plausible note.

## Every commit says how it was verified

`.githooks/prepare-commit-msg` appends a `Verified-by:` trailer:

- **All static checks green** — no trailer. This only means the fast hook
  passed; the delivery receipt remains required for merge.
- **Degraded** — names which checks were red on another session's files.
- **Not run** — `Verified-by: NOTHING`. The hook was bypassed or never installed.

That last one still runs under `--no-verify`, which skips `pre-commit` but not
`prepare-commit-msg`. A bypass cannot be quiet.

## When you do bypass

`git commit --no-verify` is for a genuine emergency, not for a red you did not
cause. If you use it:

- Say so in the commit message body **and** in your report to the user.
- Say what you *did* verify, and by what means.
- Never let silence imply the checks passed.

## The rest

- **Red blocks the commit.** Fix it, or stop and report exactly what is broken.
- **Never skip, delete, or `.skip()` a test to reach green.** A failing test is
  reporting a real disagreement between the code and the rule it encodes. Change
  the code, or change the rule on purpose and say so.
- **A feature commit carries its own tests**, committed together, never as a
  follow-up. [testing.md](testing.md) says where they live and what each kind
  must cover. That holds even when the files you touched do not load testing.md.

## The index is shared — commit by pathspec

There is one git index for the whole clone, and more than one session stages into
it. So `git add` followed by `git commit` is a race: whoever commits first takes
**everything** staged, including files the other session was still preparing.

That is not hypothetical. Commit `4eaf809` (MAI-16, buying a phone number) silently
carried `CLAUDE.md`, `.claude/rules/committing.md`, and three `.githooks/` files
belonging to a different session, under a message that mentions none of them.

**Always name your paths on the commit itself:**

```bash
git commit -- path/one path/two
```

The pathspec form commits exactly those paths and ignores whatever else is in the
index. It is the only form that is safe here.

- **Stage only your own files.** Never commit or stash what another session left
  in the tree.
- **Never `git reset` or `git stash` to tidy the index.** You would be discarding
  another session's staged work.
