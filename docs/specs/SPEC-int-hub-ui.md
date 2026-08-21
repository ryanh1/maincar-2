# Spec: `int-hub-ui`

> Module `int-hub-ui` of [CAPABILITY-MAP-INTEGRATIONS.md](CAPABILITY-MAP-INTEGRATIONS.md).
> Depends on: `int-oauth`, `int-health`. Phase 4. **The first shippable point.**

## Objective

A rep sees one card per provider whose colour tells the truth. **Green only when
every permission is there.**

**Success looks like:** a rep who granted reading but refused sending sees an amber
card that says which one is missing and a button that asks for only that one.

### Acceptance criteria

1. Settings gains an **Integrations** tab, rendered like the existing tabs in
   `Settings.tsx`. It is hidden for a user with no org, as Organization and Members
   already are.
2. One card per provider, driven entirely by the server's `integrations` array.
   The client does not own the provider list, the labels, or the permission copy.
3. Status is exactly three words and never colour alone — the icon and the word
   carry it too:
   - **Connected** (green, check) — every permission granted
   - **Limited — missing permission** (amber, triangle) — a permission is missing
   - **Reconnect needed** (red, alert) — the grant is revoked or unreadable
4. A connected card shows the address and **"Verified 2m ago"** from
   `lastValidatedAt`. With no `lastValidatedAt`, it shows no timestamp rather than
   a fake one.
5. Any card that is not fully healthy renders a **recovery block**: a title and
   concrete steps, keyed from `errorCode` through `ERROR_CODE_RECOVERY`. An
   unknown code falls back to the `unknown` entry and still renders a block.
   **No error line ships without a next action.**
6. A not-connected card carries a collapsed **"Before you connect"** disclosure
   naming the two failures that look like bugs when they hit a rep cold: Google's
   unverified-app warning, and Microsoft's admin approval requirement.
7. Consent runs in a **popup**, so the rep does not lose the page. The window is
   opened **synchronously inside the click** and its URL set after the server
   answers — opening it after an `await` is what pop-up blockers exist to stop.
8. The page listens for the popup's `postMessage` and **also** polls for the window
   being closed by hand, so a spinner can never outlive the attempt.
9. A `message` event is trusted only from the app's own origin.
10. **One primary action per card.** Not connected → **Connect**. Limited → **Fix
    permissions**. Error → **Reconnect**. Connected → **Test**. Everything else on
    the card is secondary.
11. Disconnect sits behind an `AlertDialog` naming the address, and says what stops
    working.
12. A Test result renders per capability, so a rep sees which permission failed and
    why — never a bare "Test failed".
13. Loading renders a skeleton, not a spinner on an empty page. An error renders the
    server's message with a retry.
14. Every string obeys [rules/copy.md](../../.claude/rules/copy.md): one sentence,
    says what to do, "organization" never "workspace".
15. Walked in a browser in **both themes** before this is called done.

## Tech stack

React, React Query, `sonner`, existing shadcn components (`Button`, `AlertDialog`,
`Separator`, `Tabs`). `lucide-react` icons. **No new dependency.**

## Commands

```bash
npm run dev
npm test --workspace vite
npm run typecheck && npm run lint
```

## Project structure

```
vite/src/lib/integrationTypes.ts                   → NEW. Shapes + ERROR_CODE_RECOVERY + PRE_CONNECT_NOTES
vite/src/lib/queryKeys.ts                          → add the integrations key group (edit)
vite/src/hooks/integrations/index.ts               → NEW. The barrel
vite/src/hooks/integrations/useGetIntegrations.ts  → NEW
vite/src/hooks/integrations/useConnectIntegration.ts   → NEW
vite/src/hooks/integrations/useTestIntegration.ts      → NEW
vite/src/hooks/integrations/useRefreshIntegration.ts   → NEW
vite/src/hooks/integrations/useDisconnectIntegration.ts → NEW
vite/src/hooks/integrations/useGetIntegrationHealth.ts  → NEW
vite/src/pages/Settings_IntegrationsTab.tsx        → NEW. The pane
vite/src/pages/Settings_Integrations_ProviderCard.tsx → NEW. One card
vite/src/pages/Settings_Integrations_ProviderMark.tsx → NEW. The provider glyph
vite/src/pages/Settings.tsx                        → add the tab (edit)
vite/src/pages/Settings_IntegrationsTab.test.tsx   → NEW
vite/src/pages/Settings_Integrations_ProviderCard.test.tsx → NEW
```

Naming follows the house `Parent_Child.tsx` convention already used by
`Settings_Members_MemberRow.tsx`
([rules/frontend.md](../../.claude/rules/frontend.md)).

## Copy

| Where | String |
|---|---|
| Tab | `Integrations` |
| Intro | `Connect the account you send email from.` |
| Not connected | `Not connected` |
| Empty-card body | `Connect to send email as you and to see meetings on your records.` |
| Disclosure | `Before you connect` |
| Google note | `Google warns that this app is not verified. Choose Advanced, then continue.` |
| Google note | `If you see "Access blocked", your Google Workspace admin must allow Maincar first.` |
| Microsoft note | `If you see "Need admin approval", your Microsoft 365 admin must approve Maincar first.` |
| Disconnect dialog | `Disconnect {provider}?` / `Maincar stops reading {address}. Connect it again any time.` |
| Popup blocked | `Allow pop-ups for this site, then click Connect again.` |

One sentence each. No second line under a heading that repeats it.

## Code style

```tsx
// The popup is opened SYNCHRONOUSLY inside the click, before any await. Opening it
// after the server answers is exactly what a pop-up blocker stops, and the rep
// just sees nothing happen.
const popup = window.open('', 'maincar-oauth', POPUP_FEATURES)
if (!popup) { toast.error('Allow pop-ups for this site, then click Connect again.'); return }
const { url } = await connect.mutateAsync({ provider, mode, connectionId })
popup.location.href = url
```

```tsx
// The rep can close the popup instead of finishing. Without this poll the card
// spins forever waiting for a message that is never coming.
pollRef.current = window.setInterval(() => {
  if (popupRef.current?.closed) { stopWatching(); setBusy(null); invalidate() }
}, 500)
```

```tsx
// Status is never colour alone. The icon and the word carry it too, so the card
// works for a rep who cannot distinguish amber from green.
const STATUS_STYLE = {
  connected: { label: 'Connected', className: 'text-success', Icon: Check },
  limited:   { label: 'Limited — missing permission', className: 'text-warning', Icon: TriangleAlert },
  error:     { label: 'Reconnect needed', className: 'text-danger', Icon: CircleAlert },
} as const
```

## Testing strategy

The API is mocked at `jsonFetch`. Component tests sit beside the component
([rules/testing.md](../../.claude/rules/testing.md)).

- A provider with `connection: null` renders "Not connected" and one **Connect**.
- A `connected` connection renders green, the address, and "Verified …".
- **A `limited` connection renders amber, names the missing permission, and its
  primary button reads "Fix permissions".** The single most important test here.
- An `error` connection renders red with **Reconnect**.
- Every `errorCode` in `ERROR_CODE_RECOVERY` renders its title and its fixes.
- **An unrecognised `errorCode` still renders a recovery block**, from `unknown`.
- A Test returning one failed capability lists all three with the failure named.
- "Before you connect" is collapsed by default and expands on click.
- Disconnect does nothing until the dialog is confirmed.
- A blocked popup shows the pop-ups toast and no spinner is left running.
- A `message` event from a foreign origin is ignored.
- Loading renders the skeleton; an error renders the server's message.
- No test asserts on colour alone — each asserts on the word or the icon.

## Boundaries

**Always** — open the popup inside the click; verify the message origin; render one
primary action per card; pair every error with a recovery block; carry status in a
word and an icon, not only a colour; walk it in both themes.
**Ask first** — adding a provider card the server does not return; showing a
permission the rep was never asked to grant; a full-page redirect instead of the
popup.
**Never** — show a partially-granted connection as connected; render a "Sync"
control (nothing consumes it — [CLAUDE.md](../../CLAUDE.md)); hard-code the
provider list in the client; show an error with no next action.

## Success criteria

- [ ] All 15 acceptance criteria hold.
- [ ] A rep connects Google in a real browser, refuses one permission, sees amber,
      clicks Fix permissions, and lands green.
- [ ] Walked in both themes.
- [ ] `npm run typecheck && npm run lint && npm test` pass.

## Open questions

1. Does the broken-connection badge live in the sidebar next to Settings, or only
   on the page? *(Recommendation: sidebar. A rep who is not on the Settings page is
   exactly the rep who needs telling.)*
