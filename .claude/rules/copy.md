---
paths:
  - "vite/src/**"
---

# Writing user-facing copy

> Split out of the always-loaded CLAUDE.md on 2026-08-20 so it loads only when
> you touch matching files. Same authority as CLAUDE.md. Do not duplicate it back.

## Writing user-facing copy

Applies to every UI string, toast, error, email, and doc. **The bar: short and
actionable.** A rep reads this between live calls.

- **One sentence. Cut the second one.** If a heading and the line under it say the
  same thing, delete the line. Most headings need nothing under them.
- **Say what to do, not what is true.** Every message with a problem in it names the
  next action.
- **Buttons are verbs, and the verb survives the flow.** "Publish" produces
  "Published." Never "Submit", "OK", or "Continue" where a real verb fits.
- **No filler.** Delete "Welcome back.", "Get started.", "Let's set things up.", and
  anything that explains a concept the screen already shows.
- **Plain words, active voice, complete sentences.** No em-dash or semicolon joining
  two clauses — write one sentence, or two.
- **Prefer the role noun over a pronoun** — "the admin", "the rep", "the caller".
- **Errors do not apologize and are never vague.** They say what happened and the fix.
- **An empty state is an invitation to act**, not an explanation of emptiness.
- **The tenant is an "organization".** The schema and the API say `org` / `orgId`;
  every screen says "organization". Never "workspace" — that word comes from
  `lita` and `loadwire` and means nothing here.

| Instead of | Write |
|---|---|
| "An organization is your company's home in Maincar. Your contacts, calls, and settings all live inside it. Most people name it after their company." | "Name it after your company." |
| "Sign in to Maincar" / "Welcome back." | "Sign in" (drop the subtitle) |
| "A number of your own is the line every outbound call goes out on." | "You need a number to call out." |
| "This invite link cannot be used. It may have expired, been revoked, or already been accepted." | "This invite is no longer valid. Ask the admin for a new one." |
| "Are you sure you want to delete this record?" | "Delete this company? This cannot be undone." |
| "An error occurred while saving." | "Could not save. Check your connection and try again." |

## Icon-button tooltips

Every icon-only button carries a tooltip and a matching accessible name. That
they are both required, and which component supplies them, is a design rule —
[design-system.md](design-system.md) → **Icon-only buttons**. This is what they
say.

- **Name the action AND its object, as a verb phrase.** "Refresh the member
  list", never "Refresh". A lone verb is the failure this rule exists for: a
  person looking at a circular arrow already knows a verb is involved, and
  "Refresh" tells them nothing they did not have. If the button acts on one row,
  the object is that row — "Revoke the invite for sam@acme.com".
- **The tooltip and the accessible name are the same string.** Two audiences,
  one promise. `IconButton` takes one `tooltip` prop and feeds both, so this is
  the default rather than a thing to check.
- **Sentence case. No trailing period.** It is a fragment, not a sentence.
- **A destructive icon button names the consequence, not just the verb.** The
  glyph gives no warning, so the words carry it. "Create a new invite link for
  sam@acme.com and cancel the old one" — not "Regenerate", which sounds free,
  and not "Create a new link", which hides that the current link dies.

| Instead of | Write |
|---|---|
| "Refresh" | "Refresh the member list" |
| "Regenerate" | "Create a new invite link for sam@acme.com and cancel the old one" |
| "Delete" | "Delete the recording for this call" |
| "More" / "Actions" | "Show actions for sam@acme.com" |
| "Menu" | "Open the navigation menu" |
| "Toggle" | "Show password" |
