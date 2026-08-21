# Project rules (Claude Code) — maincar-2

Read this first. Rules are split across `.claude/rules/` files and loaded automatically by Claude Code when relevant to your work. This file stays focused on cross-cutting rules that apply everywhere.

Layout: `vite/` is the React client, `server/` is the Express API, `firebase/` holds the emulator config, `docker/` holds local Postgres + MinIO. Ports and commands are in [README.md](README.md).

## Rules organized by file

Claude Code auto-loads the rules for what you're touching.

- **Frontend work** → [copy.md](.claude/rules/copy.md), [design-system.md](.claude/rules/design-system.md), [frontend.md](.claude/rules/frontend.md)
- **Server work** → [server-routes.md](.claude/rules/server-routes.md), [database-and-prisma.md](.claude/rules/database-and-prisma.md), [dependencies-and-config.md](.claude/rules/dependencies-and-config.md)
- **Testing** → [testing.md](.claude/rules/testing.md)

## Dates & Times (Timezones)

Every time-of-day shown to a person MUST render in an explicit timezone and carry a zone label (`Jun 24, 2026, 6:00 PM EDT`). Never display a bare local time, and never let formatting fall back to the server's zone.

- **Timezone source**: each user has an IANA `timeZone` on the `User` record, captured at onboarding and defaulted from `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- **Client**: render in the **viewing user's** zone, through helpers in `vite/src/lib/datetime.ts`. Never call `toLocaleString` directly in a component.
- **Server**: render in the **accountable user's** zone, with a documented fallback.
- **Date-only values** (a calendar date with no time) render with no time and no zone.
- **An LLM must never invent a timezone.** Hand it a pre-formatted string with the zone label already in it, and tell it to state that string verbatim.

## AI drafting

**Never let a model draft ahead of its data.** Any value a model states to a user must be known to it *before* it drafts — read from the input, or handed in via the prompt or a tool result. Never compute a user-facing value *after* the draft and store it without feeding the SAME value into the draft, or the text and the stored record disagree.

## Verification before finishing

- **After editing UI**, run `npm run typecheck` and `npm run lint` at the repo root. TypeScript does not always report an undefined JSX component; the build does.
- **Run `npm test`** before calling anything done.
- **Walk the journey in a browser** for anything user-facing. Parts passing in isolation is not evidence the journey works. A route path is a string, so `tsc` cannot verify a rename — click it.
- **Never leave a feature half-wired.** If a control cannot be finished, do not render it, or render it visibly disabled with an honest label. Never ship a live-looking control that does nothing.
- **Report what you could not verify**, at the step where it applies.

## Money

Never spend the user's money — a paid API call, a purchased phone number, a deploy that bills — without asking **in the turn the spend would happen**. A plan that mentions a purchase is not consent, and approval does not carry across turns.
