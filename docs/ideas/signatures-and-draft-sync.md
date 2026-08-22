# Email signatures + draft sync/scope

## Problem Statement

How might we let a user maintain multiple email signatures and pick one per outgoing email, without adding sync complexity to how drafts are stored?

## Recommended Direction

**Signatures:** Full CRUD under Settings → Mail → Signatures. A user can create, edit, delete, and name multiple signatures, and mark one as default. In the composer, a signature picker lets the user swap the inserted signature per email before sending. This is a real feature, not a small tweak.

**Draft storage:** Stays app-only in maincar-2's own database until the user hits Send. Do not synchronize an unsent draft to the connected Google or Microsoft mailbox. This avoids conflict resolution and keeps scope to the existing server-side draft persistence.

**All-drafts view:** Open. Do not scope or estimate it yet.

## Key Assumptions to Validate

- [ ] A `Signature` model scoped per-user, not per-org, matches the mailbox and identity model.
- [ ] The rich-text editor supports programmatic HTML insertion at the cursor or end.
- [ ] No existing signature support already exists elsewhere in the mailbox code.

## MVP Scope

**In:** Signature create, edit, delete, rename, a default-signature flag, Settings → Mail → Signatures, and a composer signature picker. New drafts use the default when no signature is chosen.

**Out:** Provider-native draft synchronization and an all-drafts management page.

## Not Doing

- Syncing drafts to Gmail or Outlook as provider-native drafts. That adds conflict handling for no clear benefit.
- Per-mailbox default signatures. A single default plus a per-email picker meets the requested need with less complexity.

## Open Questions

- The all-drafts management view remains pending separate instructions.
