# Plan: Integration Hub

**Spec:** [docs/specs/CAPABILITY-MAP-INTEGRATIONS.md](../docs/specs/CAPABILITY-MAP-INTEGRATIONS.md)
plus six module specs, `SPEC-int-schema` · `-oauth` · `-seam` · `-health` ·
`-hub-ui` · `-mailboxes`.
**Issues:** [tasks/linear-issues-integrations.md](linear-issues-integrations.md)
**Linear project:** `Integration Hub` · team `MAI`

## Dependency graph

```
                          IH-1  tokenCrypto
                          IH-2  schema + migration
                             │
              ┌──────────────┴──────────────┐
        IH-3 oauthConnections          IH-4 mailAccounts
              │                             │
   ┌──────────┴───────────┐                 │
   │                      │                 │
 PHASE 2a int-oauth   PHASE 2b int-seam     │
   IH-5 state             IH-12 MailProvider│
   IH-6 scopes            IH-13 SDK wrappers│
   IH-7 providers         IH-14 contract    │
   IH-8 error codes       IH-15 googleMail  │
   IH-9 authorize+list    IH-16 microsoftMail
   IH-10 callback ────────┤ IH-17 getMailProvider
   IH-11 verification     │
                    ══ CHECKPOINT A ══
                          │
                   PHASE 3 int-health
                   IH-18 probes → IH-19 test/refresh → IH-20 health
                          │
                   PHASE 4 int-hub-ui
                   IH-21 types → IH-22 hooks → IH-23 card → IH-24 pane
                                            IH-25 disconnect  IH-26 badge
                    ══ CHECKPOINT B — first shippable ══
                          │
                   PHASE 5 int-mailboxes
                   IH-27 routes → IH-28 hooks → IH-29 row → IH-30 drawer
                    ══ CHECKPOINT C ══
```

## Why the slices are shaped this way

**Phases 1–3 have no user-facing surface at all.** That is deliberate. A hub UI
built before the seam would need a fake provider behind it, and a fake would then
have to be torn out — which is the rework this ordering exists to avoid. Nothing
half-wired is visible before Phase 4, because nothing is visible before Phase 4.

**Phase 4 is the first shippable point.** After IH-26 a rep can connect a mailbox,
see its honest status, test it, and disconnect it. Everything before that is
infrastructure with tests as its only witness, and every one of those tickets says
so in its verification.

**IH-14 comes before IH-15 and IH-16.** The shared contract suite is written
against the interface, then both implementations are made to pass it. Written the
other way round, the suite ends up describing whichever provider was built first
and the second one bends the seam to fit.

**IH-11 (Google verification) is scheduled early and has no code.** It is a
weeks-long external review and the only task here whose duration nobody on the
team controls. Starting it late is how this initiative slips.

## Parallel work

- **IH-5, IH-6, IH-8, IH-12, IH-13** have no dependency on each other and can be
  taken in any order or at the same time.
- **Phase 2a and Phase 2b are fully parallel** once IH-3 lands. Two people can work
  the whole of each without touching the same file, except `mailErrors.ts`, which
  IH-4 creates and IH-12 extends. IH-4 lands first.
- **IH-15 and IH-16 are parallel** once IH-14 exists.

## Rules that apply to every ticket

Inherited from [CLAUDE.md](../CLAUDE.md), and not repeated in each issue:

- `npm test && npm run typecheck && npm run lint` pass at the repo root before any
  commit or push. Red blocks the commit.
- **A feature commit carries its own tests.** Never as a follow-up.
- Anything user-facing is **walked in a browser in both themes**.
- Work on the current branch. Another session may be in the same tree.
- Never write migration SQL by hand — schema first, then `npm run db:migrate`.
- Commit messages use the Linear key: `MAI-123: Short description`.

## Estimates

Points are relative, unanchored, and stay in the issue body only — no Linear
estimate field is set, for the same reason the composer project gave: nobody has
calibrated a scale, and a number in that field would read as more certain than it
is.

| Phase | Issues | Points |
|---|---|---|
| 1 — int-schema | IH-1 … IH-4 | 13 |
| 2a — int-oauth | IH-5 … IH-11 | 24 |
| 2b — int-seam | IH-12 … IH-17 | 26 |
| 3 — int-health | IH-18 … IH-20 | 11 |
| 4 — int-hub-ui | IH-21 … IH-26 | 21 |
| 5 — int-mailboxes | IH-27 … IH-30 | 14 |
| | **30 issues + 3 checkpoints** | **109** |

## What this plan deliberately leaves out

Named so a later reader knows these were decided, not missed:

- **Slack and Teams.** Loadwire has both. maincar-2 has no notification feature to
  post to, so they would ship connected and inert.
- **A mail or calendar sync job.** The seam exposes read and calendar as tested
  methods; nothing polls. There is no `Person` or `Company` for captured activity
  to attach to.
- **Shared and delegated mailboxes.** They need a visibility model and an approver.
  Separate feature.
- **Import past messages, per-mailbox automation switches, label legends.** All
  three exist in loadwire and all three need a pipeline that does not exist here.
- **`composer-send`.** It is the Email Composer Dock project's Phase 4, unblocked
  by IH-17, and planned there.
