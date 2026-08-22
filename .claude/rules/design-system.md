---
paths:
  - "vite/src/**"
---

# Design system (do not deviate)

> Split out of the always-loaded CLAUDE.md on 2026-08-20 so it loads only when
> you touch matching files. Same authority as CLAUDE.md. Do not duplicate it back.

## Design system (do not deviate)

The identity lives in [12c-brand-and-identity](docs/development-guidelines/12c-brand-and-identity.md)
and the token mechanism in [16-theming-and-dark-mode](docs/development-guidelines/16-theming-and-dark-mode.md).
This section is the enforceable subset. **Read it before building any screen.**

**Benchmarks:** Attio for sizing, spacing, and overall feel. Google Sheets for the
dense grid. shadcn/ui page templates for surface and border treatment. Airtable is a
**negative** benchmark for color — never a rainbow.

### Typography

- **One face: Inter**, self-hosted, `font-sans`. No second family. No `font-mono`
  unless asked. Never Roboto, Arial, or a system stack.
- **Type scale — these four sizes only:**
  | Class | Size | Used for |
  |---|---|---|
  | `text-xs` | 12px | Table column headers, meta, timestamps, helper text |
  | `text-sm` | 14px | **Default.** Body, every control, every table cell, `<h2>` section headings |
  | `text-base` | 16px | Page title in `PageHeader`, empty-state headline |
  | `text-xl` | 20px | Auth screens only (sign-in, sign-up, join, create organization) |
  `text-lg`, `text-2xl`, and larger are **forbidden**.
- **Weights: 400 body, 500 controls and labels, 600 headings.** Never 700+.
- **Numbers align.** Any column of numbers, duration, count, or money gets
  `tabular-nums`.

### Color

- **Every color reads a token.** No hex in a component, no Tailwind palette color
  (`bg-emerald-500`, `text-slate-400`). Tokens live in `vite/src/index.css` and are
  exposed as semantic Tailwind names in `vite/tailwind.config.js`.
- **White page, tinted chrome, visible borders.** This is the contrast rule, and it
  is the one place we deliberately differ from Attio.
  | Token | Where it goes |
  |---|---|
  | `bg-bg` | The page and any content panel. Stays white. |
  | `bg-surface` | Chrome: sidebar, toolbars, table header row, secondary buttons |
  | `bg-surface-2` | Hover and pressed states, nested chrome |
  | `border-border` | Every edge. Always visible — never a washed-out hairline. |
  | `text-text` / `text-text-muted` | Primary and secondary text |
- **One accent: `primary` — ocean, a deep blue-cyan (`#0E7490`).** It marks the
  primary button, the active nav row, focus rings, and selection. Nothing else.
  A second accent is forbidden.
- **The one exception: a third-party OAuth provider's own brand mark** (Google,
  Microsoft) in the Integration Hub. That logo identifies THEM, not Maincar's UI, so
  it is never recoloured or replaced with a token — `Settings_Integrations_ProviderMark.tsx`
  renders it as-is, at a fixed small size, and nowhere else in the app uses a brand
  colour or a non-token image.
- **The accent is never in a status family.** `success` is green, `warning` amber,
  `danger` red, and the accent stays clear of all three. The Call button is `success`,
  so it must never read as "the primary button".
- **Status colors are `success` / `warning` / `danger` only**, and they mean the same
  thing on every screen. No per-feature color. Status is never color alone — always a
  label or an icon with it.
- **Category and option colors come from `--option-1…8`** — muted tints of one
  family, assigned by `lib/optionPalette.ts`, stored as the token name, never a hex.
- **Dark mode is not optional.** No screen ships until it is correct in both themes.
  If a color is not a token, dark mode is already broken.

### Spacing, size, and density

- **4px rhythm.** Use Tailwind steps `1, 2, 3, 4, 6, 8, 12, 16` only
  (4/8/12/16/24/32/48/64px). `p-5`, `py-7`, `gap-9` are forbidden.
- **One control height: `h-8` (32px).** Buttons, inputs, selects, date pickers,
  toolbar controls, search boxes. No exceptions.
- **Table row height: 32px for a row of plain text.** The header row is always
  32px, because it never holds a control.
  A row whose cell holds a control **cannot** also be 32px: `h-8` is 32px, so the
  control alone fills the row and the cell padding has nowhere to go. **That row
  is 40px** — the `h-8` control with 4px above and below (`py-1`), still on the
  4px rhythm. Never shrink the control to make the row: `h-8` has no exceptions,
  and the row gives way instead.
  Members and Calls sit at `py-2` (48px) today. Both are hand-rolled tables that
  predate the shared `DataTable` still listed as not-built-yet below; 40px lands
  when that component does.
- **Icons are 16px** inside controls and rows (`size={16}`), 14px inside a chip.
- **Widths:** auth card `max-w-sm` · single-column form `max-w-md` · settings pane
  `max-w-5xl` · table pages are full width.
  The settings pane is the carve-out, and it is deliberate. It was `max-w-2xl`
  (672px) until commit `f987b51`; a settings pane holds tables, and **Tables and
  grids** below requires those to match Loadwire's at minimum, which five columns
  cannot do in 672px. That gap is what "the members table is too scrunched"
  meant. `max-w-5xl` (1024px) is Loadwire's shell.
  Widening the shell does not widen the fields inside it. A settings pane that
  holds only a form still constrains that form itself — Profile and Organization
  each wrap their inputs in `max-w-sm` inside the wider shell.
- **Page padding: `p-6`.** Section gap: `gap-6`. Field gap inside a form: `gap-3`.

### Radius, borders, shadow

- **Radius: `rounded-md` everywhere.** `rounded-full` only for avatars and chips.
  `rounded-lg` / `rounded-xl` are forbidden.
- **Borders are `border border-border`, 1px.** Everything that is a surface, a
  control, or a container gets one.
- **Never put a ring and a border of different colors on the same element.** A gray
  border under a colored glow reads as a rendering bug. The focus ring is `primary`,
  so on focus either drop the border or move it to `primary` as well.
- **One shadow: `shadow-md`, and only on things that float** — popovers, dropdowns,
  dialogs, the dialer. A static panel never has a shadow.

### Components (reuse, never re-invent)

Build from these. If none fits, **stop and ask** before inventing one.

| Need | Use | Path |
|---|---|---|
| Any button | `Button` / `buttonClasses` | `components/ui/button.tsx` |
| Text field | `Input` | `components/ui/input.tsx` |
| Field label | `Label` | `components/ui/label.tsx` |
| Dropdown choice | shadcn `Select` — **never** `<select>` | `components/ui/select.tsx` |
| Date | `DatePicker` — **never** `<input type="date">` | `components/ui/date-picker.tsx` |
| Menu of actions | `DropdownMenu` | `components/ui/dropdown-menu.tsx` |
| Modal | `Dialog` | `components/ui/dialog.tsx` |
| Destructive confirm | `AlertDialog` — **never** `window.confirm` | `components/ui/alert-dialog.tsx` |
| Transient feedback | `toast` (sonner) | `components/ui/toaster.tsx` |
| Icon-only button | `IconButton` — `tooltip` is required | `components/ui/icon-button.tsx` |
| Hover hint | `Tooltip` — provider is mounted once, in `App.tsx` | `components/ui/tooltip.tsx` |
| Divider | `Separator` | `components/ui/separator.tsx` |
| Copy to clipboard | `CopyButton` | `components/ui/copy-button.tsx` |
| Paging | `Pagination` | `components/ui/pagination.tsx` |
| Person / org tile | `Avatar` / `OrgAvatar` | `components/Avatar.tsx` |
| Nothing here yet | `EmptyState` | `components/EmptyState.tsx` |
| Sign-in style screens | `AuthCard` | `components/AuthCard.tsx` |
| Sidebar row | `navLinkClass` | `components/navLinkClass.ts` |
| Record field editing | `FieldValueEditor` | `components/crm/FieldValueEditor.tsx` |
| Option chip | `OptionChip` | `components/crm/OptionChip.tsx` |

**Not built yet — build these once, then reuse them everywhere:** `PageHeader`,
`Card` (shadcn), `DataTable`, `RequiredAsterisk`, and the Glide record grid. Until a
screen can use them, it does not match this section, and that is a known gap, not a
licence to invent a local version.

Add missing shadcn primitives with the shadcn generator, then re-point them at our
tokens. Never hand-roll a primitive shadcn already has.

### Icon-only buttons

A button whose only content is a glyph owes its reader **two** things, and they
are not the same thing:

- a **tooltip**, for the sighted person who does not recognise the icon, and
- an **accessible name**, because a tooltip never reaches a screen reader.

Neither substitutes for the other. `aria-label` on its own leaves a sighted
reader guessing — the complaint that produced this rule was "I don't know what
the refresh button does" — and a tooltip on its own leaves a screen reader
announcing "button".

- **Use `IconButton`** (`components/ui/icon-button.tsx`). Its `tooltip` prop is
  required and feeds both the tooltip and the `aria-label`, so the two cannot
  drift and a missing one is a build error rather than a thing you remembered.
  Hand-wire `Tooltip` only where the control takes no `buttonVariants` at all —
  the eye toggle inside `PasswordInput` is the only current example — and then
  supply both by hand, from one string.
- **The provider is mounted once, in `App.tsx`.** Never mount a local
  `TooltipProvider`. Tests go through `renderWithProviders` (`test/utils.tsx`),
  which mounts one to match the app; a test using bare `render` wraps its own,
  because Radix throws when a tooltip has no provider above it.
- **A disabled `<button>` swallows hover**, so its tooltip never opens. The
  trigger has to be a wrapping `<span>`. `IconButton` does that for you.
- **The words are a copy rule**, not a design one: [copy.md](copy.md) →
  **Icon-button tooltips**.

**What a tooltip is never for:**

- **The only place a rule or a consequence is stated.** A tooltip is invisible
  until pointed at, absent on touch, and gone the moment the pointer moves.
  Anything a person needs in order to act correctly also lives somewhere they
  cannot miss — on the screen, in the confirm dialog, or in the toast that
  follows.
- **The reason a control is disabled**, when that reason is the thing worth
  saying. Say the reason where it can be read: as a line under the control, in
  the row, or in the menu item's own label — `Settings_Members_MemberRow`
  relabels its item "Transfer ownership first" rather than greying it silently.
  A blocker does not get to hide behind a hover.
- **A substitute for a visible label on a primary action.** The one primary
  button on a screen or dialog carries words. If an action matters enough to be
  primary, it is not an icon.

### Control behavior

- **Textareas never resize.** Always `resize-none`. A drag handle breaks the layout
  and the 4px rhythm.
- **Hover shifts the shade, never the color.** Go one step darker or lighter — that is
  what `bg-surface-2` is for. A control must never change color family on hover, and a
  secondary button never turns into a colored one.
- **A dropdown trigger shows a `ChevronDown`**, 16px, on the right. A filter button
  that opens a menu is a dropdown trigger, so it gets one too. Without it the control
  reads as a plain button.
- **`CopyButton` swaps its icon to a checkmark for 1.5 seconds** after a successful
  copy, and the text label does not change. Track which row was copied by id, then
  clear it. On failure, show a `toast` error instead.

### Page and section structure

- **Every page opens with `PageHeader`** — a sticky 48px bar: icon, title
  (`text-base font-semibold`), optional count, primary action on the right, bottom
  border. One component, every page, settings included.
- **Sections are shadcn `Card`s.** A settings pane, a form group, and a content panel
  are each a `Card` with a `CardHeader` and a `text-sm font-semibold` title. This
  replaces the old "plain `<section>`, no card borders" rule.
- **One primary button per screen or dialog.** Everything else is `secondary`.
  Destructive actions use the `destructive` variant, behind an `AlertDialog`.
- **The sidebar always shows the current page as a selected row.**
- **Never show a raw enum value** (role, status, disposition). Map it to a label.
- **Never ship a live-looking control that does nothing.** Hide it, or render it
  visibly disabled with an honest line naming what it waits on.

### Tables and grids

Two components, each used where it fits. A `<ul>` of rows is never a table.

- **Object record grids** (companies, people, calls — can reach 100k rows) use
  **Glide Data Grid** (`@glideapps/glide-data-grid`), canvas, 60fps, Sheets-like:
  visible gridlines, a tinted frozen header row, keyboard cell navigation.
- **Settings and admin lists** (members, phone numbers, fields, devices) use the
  shared **`DataTable`** HTML table component.
- **Both carry the same baseline** — server-side pagination with a real page size,
  server-side sorting, a server-side search box, useful empty/loading/error states,
  row actions in an overflow menu, destructive ones behind a confirm, and page, sort,
  and search in the URL. **Match Loadwire's tables** (`../loadwire`) at minimum.
- **Header rows are distinct from body rows.** Every HTML table header `<tr>` uses
  `bg-surface` with `border-b border-border`; column headings use `text-xs`
  `font-medium text-text-muted`. Body rows keep the page background, so headers
  remain easy to scan in both themes.

### Motion

- **120–200ms, ease-out, and only on state changes** — hover, open, close, selection.
- Optimistic updates mean motion confirms an action already done. Never a blocking
  spinner where a skeleton or an optimistic row will do.
- Respect `prefers-reduced-motion`. No decorative or ambient animation.

### Forbidden

- Hardcoded hex, Tailwind palette colors, a second accent, rainbow category colors.
- A second font family, `text-lg` or larger outside auth, weights of 700+.
- `rounded-lg` / `rounded-xl`, shadows on static panels, control heights other than
  `h-8`, spacing off the 4px steps.
- Native `<select>`, `<input type="date">`, `window.confirm`, `window.alert`.
- A resizable textarea, a ring in one color over a border in another, and a hover
  state that changes color family.
- A new component style when one in the table above fits.
- Decorative subtitles, three-card feature rows, and "built for the modern team" copy.

### Rule

**Before building any screen, re-read this section and reuse what is listed. If you
need a pattern that is not here, stop and ask first.**
