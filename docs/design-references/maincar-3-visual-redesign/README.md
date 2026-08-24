# Maincar-3 visual redesign — durable reference

**Ticket:** [MAI-542](https://linear.app/maincar2/issue/MAI-542/capture-the-durable-visual-reference-and-routestate-parity-matrix)
**Parent draft:** [MAI-509](https://linear.app/maincar2/issue/MAI-509/apply-a-unified-visual-system-across-every-maincar-3-surface) — "Apply a unified visual system across every Maincar-3 surface"
**Project:** [Maincar-3 Visual Redesign](https://linear.app/maincar2/project/maincar-3-visual-redesign-73cff79097ca)

## Why this exists

The design mockup arrived as a Claude Artifact (a design canvas, frame UUID
`a8e27a94-529a-45e6-8339-936f90f98598`). That artifact is a **private, session-dependent
web page** — it renders correctly only for someone signed in to the Claude account that
owns it. It is not a durable reference: a teammate without that login, or an agent running
outside this chat, cannot open it.

This folder is the durable replacement. Everything a later visual-redesign issue needs is
committed here, in the repo, openable by anyone with repo access.

## What's here

| File | What it is |
|---|---|
| [`companies-grid.html`](./companies-grid.html) | Self-contained static reproduction of the mockup's "Companies grid" artboard. Open directly in any browser — no server, no login, no JS runtime dependency. |
| [`settings-profile.html`](./settings-profile.html) | Same, for the mockup's "Settings · Profile" artboard. |
| [`route-state-parity-matrix.md`](./route-state-parity-matrix.md) | Every current Maincar-3 route and shared overlay, and whether the mockup covers it. |
| [`decision-list.md`](./decision-list.md) | [MAI-543](https://linear.app/maincar2/issue/MAI-543/reconcile-the-approved-mockup-with-global-ui-rules-and-shadcnui)'s row-by-row reconciliation of this mockup against `.claude/rules/design-system.md`, `copy.md`, and `frontend.md` — what changed, what already matched, and why. |
| `source/Main.dc.html`, `source/Profile.dc.html` | The original design-canvas artboard source (template + the JS that supplies its data), exactly as authored in the Claude Design canvas. Kept for provenance; not meant to be opened directly (it depends on a canvas runtime the static HTML files above do not need). |
| `source/canvas.json` | The canvas layout: artboard titles, positions, and the author's own annotation note (quoted below). |

The two `.html` files at the top level are the reference. They were built by resolving the
`source/*.dc.html` templates against the exact data literal in each artboard's own script —
same colors, same copy, same numbers, same layout — then stripped of the canvas-editor
runtime so they render as plain static HTML anywhere. Diff them against a live screen with
your browser's devtools, or just look at them.

## What the mockup covers — and what it doesn't

The mockup is **two desktop artboards, light mode only**. There is no dark-mode variant and
no mobile/narrow variant in the source. See
[`route-state-parity-matrix.md`](./route-state-parity-matrix.md) for the full breakdown
against every real route; per [project rules](../../../.claude/rules), nothing here infers
or invents an unseen state, viewport, or theme.

1. **Companies grid** — a *new* screen. No current Maincar-3 route implements a companies
   grid workspace like this yet (the closest existing thing is `/lists/:listId` → `CrmGrid`,
   which uses Glide Data Grid, not this table treatment). Treat this as direction for that
   future surface, not a redesign of a page that already exists.
2. **Settings · Profile** — a restyle of the *existing* `/settings/profile` screen
   (`Settings_ProfileTab.tsx`), on the same layout and field set it has today.

## The author's own annotation (from `canvas.json`)

> MAI-509 visual system draft.
> Inter at 13-14px, compact light nav rail, one ocean accent (#0E7490), white working
> canvas, 36px grid rows with hairline dividers, semantic pills only, 32px controls.
> Left: the new Companies grid workspace. Right: the existing Settings > Profile screen
> restyled on the same system.

Cross-check: the accent hex quoted above, `#0E7490`, is the **same value already assigned**
to the `primary` token in [`design-system.md`](../../../.claude/rules/design-system.md).
The mockup's direction is compatible with the existing token, not a request to change it.

## No production UI changed

This ticket (MAI-542) only adds these reference files. It does not touch `vite/src` or any
shipped screen.
