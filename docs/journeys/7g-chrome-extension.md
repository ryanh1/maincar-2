# Doc 7g — The Chrome Extension (page context)

Part of the **AI Copilot** family (head: [7 — AI Copilot](7-ai-copilot.md)). Lets a rep on a prospect's LinkedIn or company website ask the agent about **that page** without copy-paste. Split out of the old **Journey 7.10**. The agent that consumes it is [7e](7e-agent-surface.md).

**Design stance: privacy first, on-demand only.** Nothing is read until the rep turns it on, and even then the page is read **only when it's actually needed** — not continuously.

Under each journey: **Benchmark (beat this)** = the product to match. **Build docs** = the technical page.

---

## Journey 7g.1 — Install and grant access (off by default)

*As a rep, I want to control which sites the agent may read, so it never sees pages I didn't opt into.*

1. **Entry.** He installs the extension, then in **Settings → Extension** finds a master toggle **"Let the agent read the page I'm viewing"** (**off by default**), plus **per-site grants** (enable for LinkedIn and target company domains, not all sites).
2. **If the toggle is off (then):** the agent has no page access and the tool (7g.2) returns "page access is off."
- **Benchmark (beat this):** ChatGPT Atlas — user-gated page access; Clay/Apollo extensions — user-action capture — https://university.clay.com/docs/clay-chrome-extensions . **Build docs:** Chrome `activeTab` + optional per-site host permissions.

## Journey 7g.2 — The agent reads the page as a tool call (primary model)

*As a rep, I want the agent to pull the page only when my question needs it, so it stays fresh and private.*

1. He asks the agent (in the app or the extension popup): *"Is this a real business?"*
2. The agent has a **`get_current_page_context` tool**. When the prompt needs the page, the agent **calls the tool**; the extension **live-reads the current tab** (URL, title, visible text) and returns it as the tool result. Context is fetched **only when relevant** and is always **fresh** (read at call time, not cached).
- **Why a tool call (not a running feed):** it's fetched on demand, so the minimum is read, at the moment it's needed — native to our tool-calling agent ([7e.4](7e-agent-surface.md)). **Benchmark (beat this):** Chrome MV3 messaging. **Build docs:** `get_current_page_context` tool ↔ extension messaging.

## Journey 7g.3 — Manually send this page to the agent

*As a rep, I want a one-click "use this page now" for when I know I want it.* — A **"Send this page to the agent"** button in the extension popup attaches the current page as context for the next prompt. One click, explicit. **Build docs:** popup button → same messaging channel.

## Journey 7g.4 — How the extension talks to our server (answers 7.10.2)

*As an engineer, I want to know exactly how and when the extension is connected to us, and why that design.*

**Your question: "does this imply the extension is always in touch with our server?" — No, and deliberately not.** The extension is **not** holding a persistent connection or streaming pages to us in the background. Here's the actual model:

1. **How it connects (technically).** The extension talks to our app using Chrome MV3 **`externally_connectable` messaging** — a channel that only opens **when there's something to send**: the agent calls `get_current_page_context` (7g.2), or the rep clicks "Send this page" (7g.3). At that instant the extension reads the active tab via **`activeTab`** and posts the text to our app's origin. Between those moments, **there is no live link and nothing is read.**
2. **Why this design (not a persistent connection).** Three reasons: **privacy** (we only ever hold a page the rep's action or question asked for — never a background feed of their browsing); **least privilege** (`activeTab` + optional per-site host permissions, never all-URLs); and **freshness** (reading at call time beats a stale cached copy). A persistent "always in touch" connection would mean continuously observing the rep's browsing — exactly what we refuse to build.
3. **Guardrails.** A **visible "reading this page" indicator** on every capture + a log of pages sent; the extension answers **only** our app's origin; page text is **POSTed, never in a URL**; and — critically — **page content is treated as untrusted data, never as instructions** (a web page cannot tell the agent to do something, [7 safety]). For LinkedIn specifically, capture is **user-initiated** to respect account-safety.
- **Benchmark (beat this):** Chrome MV3 — `externally_connectable` — https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable ; `activeTab` least privilege — https://developer.chrome.com/docs/extensions/develop/concepts/activeTab . **Build docs:** MV3 manifest with `activeTab` + `externally_connectable` scoped to our origin.

## Cross-doc references preserved
Replaces the old **Journey 7.10**. Related: the agent [7e](7e-agent-surface.md) (consumes the page as a tool result), enrichment [7d](7d-enrichment.md) (research uses licensed sources, not the logged-in LinkedIn session).
