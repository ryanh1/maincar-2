# MAI-543 decision list — reconciling the mockup with the global rules

**Ticket:** [MAI-543](https://linear.app/maincar2/issue/MAI-543/reconcile-the-approved-mockup-with-global-ui-rules-and-shadcnui)
**Source reference:** [`README.md`](./README.md), [`companies-grid.html`](./companies-grid.html),
[`settings-profile.html`](./settings-profile.html) — all captured by [MAI-542](https://linear.app/maincar2/issue/MAI-542/capture-the-durable-visual-reference-and-routestate-parity-matrix).
**Rule files compared:** [`copy.md`](../../../.claude/rules/copy.md),
[`design-system.md`](../../../.claude/rules/design-system.md),
[`frontend.md`](../../../.claude/rules/frontend.md).

## How to read this

Each row is one place the mockup's literal pixel/color values and the pre-MAI-543
rules disagreed. "Decision" says what the rule now says. "Rule file changed" says
whether `design-system.md` was edited for it.

## A note on scope

MAI-543's own acceptance criteria say "no style rule is loosened merely to
reproduce a visual detail." Working through this list, that created a direct
conflict on several rows below — matching the mockup exactly means loosening the
four-size type scale, the table-header weight, and the three-color status rule.
Ryan Hollander was asked explicitly which instruction should win and chose **match
the mockup exactly; the rules follow it** — a deliberate, informed override of that
acceptance-criteria line for this ticket. This list exists so that override is
visible in the repo, not just in chat history.

## Decisions

| # | Area | Mockup value | Prior rule | Decision | Rule file changed |
|---|---|---|---|---|---|
| 1 | Default body/control text size | 13px | `text-sm` (14px) was "default" | New `text-[13px]` tier is the default for body, controls, nav rows, table/grid cells. `text-sm` (14px) narrows to `<h2>` section headings only. | Yes — Typography → type scale |
| 2 | Micro meta text | 11px | Not in the 4-size scale; smallest was `text-xs` (12px) | New `text-[11px]` tier for sidebar section labels and the user-footer email line. | Yes — Typography → type scale |
| 3 | Table/grid column header weight | 600 (bold) | `font-medium` (500), per "controls and labels" | Table/grid column headers are the one named exception to the 500-weight rule — they read as a heading for their column. | Yes — Typography → weights, and Tables and grids → header rows |
| 4 | Company "Status" column | 4 hues (Customer teal, Prospect blue, Trial amber, Churned red) | "Status colors are `success`/`warning`/`danger` only" | A record's own lifecycle field (company status, deal stage, disposition) is a **category**, not an operational status — it uses `--option-1…8` tints, one per value, same as any other category field. `success`/`warning`/`danger` stay reserved for operational signals (toasts, sync health, call outcome) and were not expanded to 4 colors. | Yes — Color → status vs. category |
| 5 | Sidebar active row / settings active tab / active filter chip | `rgba(14,116,144,0.08)` background, `#0E7490` text, medium weight | Not previously codified as a named pattern | Codified as "selected row/tab": `bg-primary/8` + `text-primary` + `font-medium`, reused everywhere a row or tab can be the current one. | Yes — Control behavior |
| 6 | Companies-grid row height | 36px, with a 14px checkbox in the row | `DataTable` rule: 32px plain / 40px with a control | The 36px value is scoped to **Glide Data Grid** specifically (a canvas grid with its own numeric row height, not built from an `h-8` HTML control) — it does not change the `DataTable` 32px/40px rule, which still governs Members, Phone numbers, and every other HTML settings table. | Yes — Tables and grids |
| 7 | Page title (`Companies`, `Settings`) | 16px / 600 | `text-base` page title in `PageHeader` | Matches already. No change. | No |
| 8 | Card/section header (`Your profile`) | 14px / 600 | `text-sm` `<h2>` heading, `Card`'s `CardHeader` at `font-semibold` | Matches already. No change. | No |
| 9 | Accent color | `#0E7490` | `primary` token, `#0E7490` | Exact match — confirms the mockup is drawn against the existing token, not a request to change it (also called out in the [durable reference's README](./README.md)). No change. | No |
| 10 | Page/chrome background split | White page (`#ffffff`), tinted sidebar/toolbar (`#f8fafc`), visible `1px #e2e8f0` borders | "White page, tinted chrome, visible borders" (`bg-bg` / `bg-surface` / `border-border`) | Matches already — the mockup's palette is Tailwind Slate, which is exactly what the existing tokens resolve to. No change. | No |
| 11 | Control height (buttons, inputs, search, pagination) | 32px throughout | `h-8` (32px), no exceptions | Matches already. No change. | No |
| 12 | Radius | 6px controls/rows, `9999px` pills/avatars | `rounded-md` everywhere, `rounded-full` for avatars/chips | Matches already. No change. | No |
| 13 | Settings pane width | 1024px total shell | `max-w-5xl` (1024px) | Matches already. No change. | No |
| 14 | Required-field marker | Red asterisk after "First name" | `RequiredAsterisk` listed as "not built yet" | Confirms the shape (a `danger`-token asterisk after the label) for whoever builds `RequiredAsterisk`. Use the `danger` token, not the mockup's raw `#be123c` hex. No rule change — this is an implementation note for a later ticket, not a new rule. | No |

## What didn't need a decision

The mockup's spacing (24px card padding, 12px field gaps, 32px section gaps),
borders, absence of shadows on static panels, icon sizing (16px in controls, 14px
in chips), and component choices (shadcn `Select`-style dropdowns, no native
`<select>`) all matched the existing rules with no conflict. `copy.md` and
`frontend.md` had nothing to reconcile — the mockup carries no user-facing copy
that contradicts either file, and neither file makes visual claims.

## How later tickets perform the visual parity loop

1. Open [`route-state-parity-matrix.md`](./route-state-parity-matrix.md) and find the
   row for the screen you're shipping.
2. Where the mockup covers that exact route/viewport/theme cell (a `✅` in the
   matrix), build against the mockup file directly, through the decisions in this
   list — not through eyeballing a screenshot.
3. Where the matrix cell is `—` (not shown), build against the written rules in
   `design-system.md` and `copy.md` as reconciled here; do not invent a look for an
   unseen state.
4. After the screen ships, mark that row `✅` in the matrix and link this decision
   list and the shipped PR from the row or from the issue.
