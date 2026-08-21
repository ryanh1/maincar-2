# Committing

The short version lives in [CLAUDE.md](../../CLAUDE.md) → **Before you commit**, because a
path-gated rule file goes unread on work that touches neither `server/**` nor
`vite/src/**`. This file holds the mechanics.

## The gate

```bash
npm run verify
```

Four checks: `typecheck`, `lint`, `test`, `test:integration`.

**The integration suite is part of the gate, not an extra.** `npm test` does not
include it, and it holds the only tests that prove the concurrency guardrails —
that two admins cannot both demote each other and leave an org with zero admins.
That guardrail was genuinely broken when first written, so this is not
hypothetical. It needs Postgres: `npm run docker:up`.

## The hook

`.githooks/pre-commit` runs the same four and refuses a red commit. Install once
per clone:

```bash
npm run hooks:install
```

Running `npm run verify` by hand first is still the habit. The hook is the
backstop, not the plan — it is the thing that catches you, not the thing that
does the checking for you.

## Another session's red is not your red

This clone normally has more than one session editing it at once (CLAUDE.md →
**Git and branching**), so the working tree regularly goes red on a half-written
file that is not yours. The hook handles that itself:

| Check | Names a file? | On failure |
| -- | -- | -- |
| typecheck | yes | Blocks only if a failing file is in **your** commit. Otherwise warns, names the foreign files, and lets you through. |
| lint | yes | Same. |
| test | no | **Always blocks.** Your change can break a test you did not stage. |
| integration test | no | **Always blocks.** |

A failure whose file cannot be determined counts as yours. Guessing in the
lenient direction is how a gate quietly stops gating.

**So you do not need `--no-verify` for someone else's unfinished work.** That was
the old failure mode: the only escape hatch was all-or-nothing, so a routine
condition forced a total bypass, and the commit shipped with *all four* checks
skipped behind a plausible note.

## Every commit says how it was verified

`.githooks/prepare-commit-msg` appends a `Verified-by:` trailer:

- **All green** — no trailer. Silence means the gate passed.
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
- **Stage only your own files.** Never commit or stash what another session left
  in the tree.
