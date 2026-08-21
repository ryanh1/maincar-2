---
paths:
  - "vite/src/**"
---

# Frontend: data fetching, naming, timezones

> Split out of the always-loaded CLAUDE.md so it loads only when
> you touch matching files. Same authority as CLAUDE.md. Do not duplicate it back.

## Frontend data fetching

- **Use `jsonFetch` from `@/lib/api`** for ALL API calls. It injects the Firebase token, logs
  the request, and distinguishes 4xx (show the server's message) from 5xx (generic).
- **React Query** for server state. **One hook per file** in domain folders;
  `Get`-prefix for reads (`useGetThings`), action verbs for mutations.
- **Every hook domain folder has an `index.ts` that re-exports its hooks**, so a
  component imports from `@/hooks/things`, never from a file path inside it.
- **Keep a hook under ~100 LOC.** Past that, pull the mapper or the request builder
  into a helper beside it.
- **Centralized `queryKeys`** — never an ad-hoc key array in a component.
- **Cache is cleared on sign-out** in `useAuth().signOut()`. Do NOT clear it anywhere else.

## Component & file naming

- Extracted sub-components use `Parent_Child.tsx`, kept in the same folder, split out
  only when large (>~200 LOC) or reused.

## Rendering dates & times (timezones)

Every human-facing time renders in an **explicit timezone with a zone label**
(`Jun 24, 2026, 6:00 PM EDT`). Never a bare local time, never the server's zone.

- Source of truth is `User.timeZone` (IANA), defaulted from the browser.
- Render through the shared datetime helpers in `vite/src/lib/datetime.ts` — never `toLocaleString` in a component.
- **Date-only values** render with no time and no zone label.
- The LLM must never invent a timezone — feed it a pre-formatted, zone-labeled string.
