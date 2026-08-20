# Project rules (Claude Code) — maincar-2

Read this before writing code. These rules are ported from the Loadwire repo, which is
this project's house style.

Layout: `vite/` is the React client, `server/` is the Express API, `firebase/` holds the
emulator config, `docker/` holds local Postgres + MinIO. Ports and commands are in
[README.md](README.md).

## HTTP

- Prefer **`fetch` over `axios`**. Do not introduce `axios` without a hard requirement.

## Third-party APIs / SDKs

- When using a third-party API or SDK, **initialize and wrap it in a dedicated file** in
  the `dependencies/` folder at the package root — NOT inside `src/`.
  - **Server**: `server/dependencies/<api>.ts`
  - **Client**: `vite/dependencies/<api>.ts`, re-exported through a one-line
    `vite/src/dependencies/<api>.ts` shim so app code imports `@/dependencies/<api>` and
    tests can `vi.mock` it cleanly.
- Keep API keys, base URLs, default headers, and client construction inside those modules.
- Application code (routes, services, hooks, components) imports the wrapper. It never
  constructs an SDK client inline.

Existing examples: `server/dependencies/firebaseAdmin.ts`, `server/dependencies/logger.ts`,
`server/dependencies/errorReporter.ts`, `vite/dependencies/firebase.ts`.

## Environment Variables & Config

- Each package has ONE `src/config.ts` that reads every environment variable.
- **NEVER** use `process.env` or `import.meta.env` outside a `config.ts`.
- **NO DEFAULT VALUES for required vars.** Use the `required()` helper (server) or `!`
  (client) so a missing var fails fast at startup. Optional vars that make a feature
  no-op may fall back to `""`.

```typescript
// ✅ Correct
export const DATABASE_URL = required('DATABASE_URL')

// ❌ Wrong — a silent default is how a server ends up on the wrong database
export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost/dev'
```

- **Server**: `server/src/config.ts` · **Client**: `vite/src/config.ts`
- One `.env` at the repo root serves both. Vite reads it through `envDir: '..'`, and only
  `VITE_`-prefixed vars reach the browser.

## App Name

`APP_NAME` is **hardcoded in each config.ts** — it is a product constant, not an env var.
Never write the literal app name in a component or route. Import it.

```typescript
import { APP_NAME } from '../config.js'   // server
import { APP_NAME } from '@/config'       // client
```

## UI Components

### Colors

- **Centralize colors** as CSS variables in `vite/src/index.css` and use the semantic
  Tailwind classes they generate: `bg-primary`, `text-muted-foreground`, `border-border`.
- **No hard-coded colors** in components. No `bg-emerald-500`, no `text-green-600`, no hex
  values outside the theme file. Need a new color? Add a token.
- Tailwind v4 is configured in CSS. There is no `tailwind.config.js` and no
  `postcss.config.js` — the `@theme inline` block in `index.css` is the config.

### Textareas

- Textareas are **never resizable**. `resize-none` is already baked into
  `@/components/ui/textarea`; do not override it.

### Buttons

- **Every button has a border** (with an inset highlight for depth).
- **Primary buttons**: the border color matches the fill color.
- **Secondary buttons**: a border with a non-colored, white, or light interior.
- **Hover states**: shift the shade by ~10%. Never jump to a different color.
- All of this lives in `@/components/ui/buttonVariants`. Add a variant there rather than
  passing one-off color classes at a call site.

### Section Containers / Cards

- **Do NOT use Card components with rounded borders** for section containers in main page
  content.
- Use plain `<section>` elements with an `<h2>` and a `<Separator />` between sections.
- **Keep borders for**: buttons, inputs, textareas, dropdowns, modals/dialogs, sidebar nav.
- **Avoid borders on**: main content sections, form groups, settings panels. Use spacing
  and typography hierarchy instead.

### Borders and Rings

- **Never mix a border color with a ring color** on the same element (a gray border with a
  colored glow, for instance).
- If you use `ring-*` for focus or active state, either drop the border or use the same
  color family for both.
- Prefer a background or border color change for state, not a ring layered over a border.

### Required Field Asterisks

- Use `<RequiredAsterisk />` for every required-field indicator.
- **Never** write an inline `<span>*</span>`.
- `import { RequiredAsterisk } from "@/components/ui/RequiredAsterisk"`
- Usage: `<Label>Field name <RequiredAsterisk /></Label>`

### Select Components

- **Always use the shadcn `Select`** from `@/components/ui/select`. Never a native
  `<select>` — it renders browser-default chrome that does not match the app.

### Date Pickers

- **Always use a `DatePicker` component**, never `<Input type="date">`, for the same
  reason. Add one from shadcn when the first date field appears.

### Toolbar & Filter Controls

- **All toolbar controls are the same height** — `h-8` (32px). `SelectTrigger` and
  `Button size="sm"` are both `h-8` by default.
- **Filter dropdown buttons** (Status, Roles, and so on) include a `<ChevronDown>` icon.

### Confirmation Dialogs

- **Never use `window.confirm`, `window.alert`, or `window.prompt`.** They render unstyled
  browser chrome that breaks the app's look.
- Use `AlertDialog` from `@/components/ui/alert-dialog` for destructive or important
  confirmations. Drive it from state, and apply the `destructive` button variant for a
  destructive action.
- Use `toast` from `sonner` for transient success and error feedback — not alerts.

### Typography

- **Never use `font-mono`** unless the user explicitly asks for it.

### Copy Button Feedback

- On a copy click, **show a checkmark for 1.5 seconds** in place of the copy icon, keeping
  the text label unchanged. Track which item was copied in state and clear it with a
  `setTimeout`.

### Role Display Labels

- **Never display a raw role value** ("basic", "admin") to a user. Use `getRoleLabel()`
  from `@/lib/roles`.

## Writing user-facing copy

Applies to everything a person reads: UI strings, toasts, error messages, emails,
marketing copy, documentation.

- **Write concise, complete sentences.** Do not trail off or chain clauses past what fits
  in one breath.
- **Do not join sentences with em-dashes or semicolons.** Two clauses means two sentences.
  Periods and commas are fine.
- **Do not use singular "they".** For one person, use the role: "the admin", "the
  customer", "the sender".

## Dates & Times (Timezones)

Every time-of-day shown to a person MUST render in an explicit timezone and carry a zone
label (`Jun 24, 2026, 6:00 PM EDT`). Never display a bare local time, and never let
formatting fall back to the server's zone.

- **Timezone source**: each user has an IANA `timeZone` on the `User` record, captured at
  onboarding and defaulted from `Intl.DateTimeFormat().resolvedOptions().timeZone`.
- **Client**: render in the **viewing user's** zone, through helpers in
  `vite/src/lib/datetime.ts`. Never call `toLocaleString` directly in a component.
- **Server**: render in the **accountable user's** zone, with a documented fallback.
- **Date-only values** (a calendar date with no time) render with no time and no zone.
- **An LLM must never invent a timezone.** Hand it a pre-formatted string with the zone
  label already in it, and tell it to state that string verbatim.

## AI drafting

**Never let a model draft ahead of its data.** Any value a model states to a user must be
known to it *before* it drafts — read from the input, or handed in via the prompt or a
tool result. Never compute a user-facing value *after* the draft and store it without
feeding the SAME value into the draft, or the text and the stored record disagree.

## Database / Prisma

### Migrations

- **NEVER write migration SQL by hand.** Always go schema-first:
  1. Edit `server/prisma/schema.prisma`
  2. Run `npm run db:migrate` (`prisma migrate dev`) with a descriptive name
  3. Prisma generates the SQL
- For a complex data migration, edit the generated file AFTER Prisma creates it.
- **Never run `prisma migrate reset` or `prisma db push`.**
- **Never `DELETE FROM` a user-data table to satisfy a migration warning.** If Prisma warns
  that a column still holds non-null values, the right move is `UPDATE <table> SET
  <column> = NULL` or a proper data migration. Ask before any destructive SQL.
- If Prisma reports drift: stop, run `npx prisma db pull --print` to inspect the live
  schema, and propose a CLI-only reconciliation plan before executing anything.

### Timestamps on All Models

- **Every model MUST have `createdAt` and `updatedAt`.**

```prisma
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
```

**Why**: consistent timestamps make auditing, debugging, and sorting possible everywhere.

### No Enums

- **NEVER use a Prisma `enum`.** Use a `String`, document the allowed values in a comment
  beside the field, and define a TypeScript union for type safety.

```prisma
// ✅ Correct
status String @default("PENDING") // PENDING, IN_REVIEW, PASSED, FAILED

// ❌ Wrong
status SubmissionStatus @default(PENDING)
```

**Why**: Postgres enums need an `ALTER TYPE` dance to add or remove a value. A String
column just changes.

## Org Isolation & Security

### Query patterns

- **Every query for org-scoped data includes an `orgId` filter — reads AND writes.**
- Single-record lookup: `findFirst({ where: { id, orgId } })`
- Mutations: `updateMany({ where: { id, orgId } })` / `deleteMany({ where: { id, orgId } })`
- **Never** use `update({ where: { id } })` or `delete({ where: { id } })` for org-scoped
  data.

```typescript
// ✅ Correct — defense in depth
const result = await prisma.thing.updateMany({ where: { id, orgId }, data })
if (result.count === 0) return void res.status(404).json({ error: 'Not found' })

// ❌ Wrong — a caller from another org can write this row
await prisma.thing.update({ where: { id }, data })
```

**Why**: Prisma's `update()` only accepts unique fields in `where`. Going through
`updateMany` with `orgId` makes a cross-org write fail even if an ownership check above it
was bypassed.

- `orgId` always comes from the verified token (`req.user.orgId`), NEVER from the request
  body or a query param.
- Public routes must not expose fields that authenticated routes do.

## Server Route Patterns

### Route wrapper (`wrapRoute`)

- Every route MUST use `wrapRoute()` from `server/src/lib/fnWrapper.ts`.
- It logs route name, requestId, userId and orgId on every request, and maps a throw to
  503 (database unreachable) or 500 (everything else).
- **Routes never write their own try/catch.**
- Name routes as the full method and path: `"GET /api/things"`, `"PATCH /api/things/:id"`.

```typescript
// ✅ Correct
router.get('/:id', requireAuth, wrapRoute('GET /api/things/:id', async (req, res) => {
  // errors are handled by the wrapper
}))
```

### Server-side logging

- **Always use the shared `logger`** from `server/dependencies/logger.ts`. Never
  `console.log` / `console.warn` / `console.error` in server code.
- Built on **pino**: pretty-printed locally, structured JSON to stdout elsewhere.
- Call signature: `logger.info({ ...fields }, "message")` — structured context first, human
  summary second.
- Levels: `debug` (local diagnostics), `info` (normal events), `warn` (recoverable),
  `error` (failures — pass the Error object as `error`, not `error.message`, so the stack
  survives).
- **Do not log secrets, full request bodies, or PII.** Log identifiers (`userId`, `orgId`,
  `route`, resource ids), not their contents.

### Route organization

Use section comments to structure a handler:
`// --- Parse & validate params ---`, `// --- Build filters ---`,
`// --- Verify ownership ---`, `// --- Execute query ---`, `// --- Return response ---`

Use the helpers in `server/src/lib/queryHelpers.ts`: `buildPaginationParams()`,
`buildSearchFilter()`, `buildDateRangeFilter()`, `buildSortParams()`, `parseArrayParam()`.

### Response shape

All API responses use **keyed objects**:

- Single resource: `res.json({ thing: {...} })`
- List: `res.json({ things: [...], total, page, limit })`
- Error: `res.json({ error: "message" })`
- **NEVER** return a flat object, and never use `data` as the key — it says nothing.

Put a mapper (`mapThingToApi`) between the database row and the wire, so a new column is
never published by accident.

### Validation

Parse request bodies with **zod**. A failed parse is a 400 with a plain-English message,
never the raw zod error.

### Webhook security

- Every external webhook MUST verify its signature, in middleware under
  `server/src/middleware/`, applied before the handler.

## Frontend Data Fetching Patterns

### API calls

- Use `jsonFetch` from `@/lib/api` for ALL API calls. It injects the Firebase token, logs
  the request, and distinguishes 4xx (show the server's message) from 5xx (generic).
- Responses are keyed, so unwrap them:

```typescript
const data = await jsonFetch<{ thing: Thing }>(`/api/things/${id}`)
return data.thing
```

### Hooks organization

- One hook per file, in a domain folder: `hooks/things/useGetThing.ts`
- `Get` prefix for reads: `useGetThing`, `useGetThings`
- Action verbs for mutations: `useCreateX`, `useUpdateX`, `useDeleteX`
- Keep a hook under 100 lines. Extract helpers if it grows.
- Each domain folder has a `types.ts` and an `index.ts` barrel. **Components import from
  the barrel only.**

```
hooks/
  things/
    index.ts            # the public surface
    types.ts            # response shapes + pure helpers
    useGetThing.ts
    useGetThings.ts
    useCreateThing.ts
```

### Query keys

- ALWAYS use the `queryKeys` registry from `@/lib/queryKeys`. Never inline a key array.

```typescript
// ✅ Correct
useQuery({ queryKey: queryKeys.things.detail(id), queryFn: () => fetchThing(id) })
queryClient.invalidateQueries({ queryKey: queryKeys.things.all })

// ❌ Wrong — one typo and the cache silently never refreshes
useQuery({ queryKey: ['things', id] })
```

### Cache management

- The React Query cache is cleared on sign-out, in `useAuth().signOut()`. Do NOT clear it
  anywhere else — use invalidation.

## Component Naming Convention

- Extracted sub-components use `Parent_Child.tsx` naming and live in the same folder:
  `CallDetailScreen.tsx` → `CallDetailScreen_MediaPlayer.tsx`.
- Only extract when the component is large (>200 lines) or reused.
- A module that exports a component AND a non-component breaks fast refresh. Split the
  non-component out — see `buttonVariants.ts`, `badgeVariants.ts`, `providers/useAuth.ts`.

## Testing

**CRITICAL: all new features MUST include tests.**

### Requirements

1. **Test every new API endpoint** — valid and invalid input, error cases, edge cases.
2. **Test every new component** — user interaction, loading state, error state.
3. **Run the existing suites** after a change, to catch regressions.
4. **Mock external services** in tests. A test never makes a real network call.
5. **Org isolation**: every route handling org-scoped data gets tests proving a user from
   Org A cannot reach Org B's data (expect 404), and that an unauthenticated caller is
   rejected (expect 401).

### Where tests live

- **Server**: `__tests__/` folders beside the source — `src/routes/__tests__/auth.test.ts`.
- **Client**: `__tests__/` folders beside the source — `src/components/__tests__/`,
  `src/lib/__tests__/`.

### Server: two suites

| | Unit | Integration |
| --- | --- | --- |
| Config | `vitest.config.ts` | `vitest.integration.config.ts` |
| Matches | `src/**/*.test.ts` | `src/**/*.integration.test.ts` |
| Database | mocked per file with `vi.mock('../../db.js')` | real Postgres, one throwaway schema per run |
| Command | `npm test` | `npm run test:integration` (needs `npm run docker:up`) |

The integration suite creates a uniquely-named schema, runs `prisma migrate deploy` into
it, and drops it on teardown. It never touches the developer's data.

### The route-test shape

`vi.hoisted()` builds the mocks, `vi.mock()` swaps the modules, and `app.js` is imported
**last** so the mocks are in place when its module graph loads. See
`server/src/routes/__tests__/auth.test.ts`.

### The component-test shape

Same idea: `vi.hoisted()` + `vi.mock()` of the hook barrel or provider, then import the
component, then `renderWithProviders` from `@/test/utils`. See
`vite/src/components/__tests__/ProtectedLayout.test.tsx`.

## Verification before finishing

- **After editing UI**, run `npm run typecheck` and `npm run lint` at the repo root.
  TypeScript does not always report an undefined JSX component; the build does.
- **Run `npm test`** before calling anything done.
- **Walk the journey in a browser** for anything user-facing. Parts passing in isolation is
  not evidence the journey works. A route path is a string, so `tsc` cannot verify a
  rename — click it.
- **Never leave a feature half-wired.** If a control cannot be finished, do not render it,
  or render it visibly disabled with an honest label. Never ship a live-looking control
  that does nothing.
- **Report what you could not verify**, at the step where it applies.

## Money

Never spend the user's money — a paid API call, a purchased phone number, a deploy that
bills — without asking **in the turn the spend would happen**. A plan that mentions a
purchase is not consent, and approval does not carry across turns.
