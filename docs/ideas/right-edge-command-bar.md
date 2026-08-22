# Right-edge command bar

> **Historical design note.** MAI-223's Linear description supersedes this
> document where they differ. Keep this note as the earlier design exploration,
> not as current implementation instructions.

## Problem Statement

How might we let a user launch a quick action (AI, email, text, calendar, call) from a fixed, low-profile spot, instead of hunting for buttons buried in the bottom dock — while still keeping today's minimize/reopen behavior for drafts and calls?

## Recommended Direction

Add a narrow icon rail fixed to the bottom-right edge of the screen, replacing the "Compose email" and dialer-launcher buttons currently in `ComposerDock.tsx` and `ProtectedLayout.tsx`. Five stacked icon buttons, top to bottom: AI sparkle, Mail, Chat, Calendar, Phone. Each has a tooltip naming the action.

Clicking an icon opens the same panel that exists today. The dialer opens as `DialerDock` in its current fixed position, and Mail opens the same `ComposerCard` compose panel. Only the trigger moves; the panel behavior, shortcuts, and positioning stay unchanged.

Drafts move off the dock entirely. The Mail icon gets a small badge showing the open or kept draft count. Clicking the badge, or the Mail icon when drafts exist, opens the existing drafts dropdown anchored to the rail.

Multiple items can stay open at once, each minimizing to a small chip. Extend the existing per-draft `isMinimized` state and the dialer's collapsed state instead of inventing a new system.

Chat and Calendar icons need their own compose surfaces. That is new scope beyond moving buttons.

## Key Assumptions to Validate

- [ ] A five-icon vertical rail fits without colliding with fixed UI at common viewport sizes.
- [ ] Reusing the existing dialer and composer panels is visually acceptable beside the rail.
- [ ] Chat and Calendar compose flows do not already exist elsewhere.

## MVP Scope

**In:** Icon rail with five buttons and tooltips; Mail and Phone connected to existing flows; draft badge and dropdown on Mail; minimize-to-chip behavior.

**Out:** New Chat, Calendar-invite, and AI workflows. Each needs its own ticket once scoped.

## Not Doing

- Rebuilding the dialer or composer panel UI.
- A generic notification-tray system for chips.
- Deciding the AI sparkle destination without a defined target flow.

## Open Questions

- Should minimized chips stack above the rail or use a horizontal strip?
- Should the rail auto-hide or collapse on small viewports?
