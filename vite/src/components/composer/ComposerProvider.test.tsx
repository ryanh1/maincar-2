import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, Route, Routes } from 'react-router-dom'
import type { QueryClient } from '@tanstack/react-query'

import type { EmailDraft } from '@/lib/emailTypes'
import { makeTestQueryClient, withProviders } from '@/test/utils'

// Only the transport, the auth state, and the toaster are mocked. The provider
// runs against the real hooks, so these tests see the actual method and body of
// every request — which is the only way to prove that closing a card is a PATCH
// and never a DELETE.
const { useAuthMock, toastErrorMock, jsonFetch } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  toastErrorMock: vi.fn(),
  jsonFetch: vi.fn(),
}))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }))
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return { ...actual, jsonFetch }
})
vi.mock('@/components/Sidebar', () => ({ Sidebar: () => <nav>sidebar</nav> }))
// The "mounted in ProtectedLayout" suite below renders the real ProtectedLayout,
// which mounts the real DialerProvider — nothing here is about the dialer, so its
// Voice SDK Device is mocked out rather than letting the real WebRTC stack run
// against a fake token.
vi.mock('@/dependencies/twilioVoice', () => ({
  Device: vi.fn(function Device() {
    return { connect: vi.fn(), on: vi.fn(), updateToken: vi.fn(), destroy: vi.fn() }
  }),
}))

import { ApiError } from '@/lib/api'
import { ProtectedLayout } from '@/components/ProtectedLayout'
import { ComposerProvider } from './ComposerProvider'
import { useComposer, useComposerOptional } from './composerContext'

function makeDraft(overrides: Partial<EmailDraft> = {}): EmailDraft {
  return {
    id: 'draft-1',
    mailAccountId: null,
    recordId: null,
    toAddrs: [],
    ccAddrs: [],
    bccAddrs: [],
    subject: null,
    bodyHtml: null,
    isOpen: true,
    createdAt: '2026-08-20T12:00:00.000Z',
    updatedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  }
}

/** What the fake server answers a GET with, per org. */
const draftsByOrg = new Map<string, EmailDraft[]>()
let created = 0
/**
 * Rows this fake server has already destroyed. The route deletes by id AND
 * userId, so a second DELETE of the same row finds nothing and 404s — which is
 * the whole point of the double-confirm test below.
 */
const deleted = new Set<string>()

function orgOf(url: string): string {
  return /orgs\/([^/]+)\/drafts/.exec(url)?.[1] ?? ''
}

function draftIdOf(url: string): string {
  return url.split('/').pop() ?? ''
}

/** Every request the fake server serves, keyed by method. */
function serve(url: string, init?: RequestInit): unknown {
  const method = init?.method ?? 'GET'
  // `ProtectedLayout` mounts `DialerProvider`, which mints itself a Voice SDK
  // token as soon as an org is known — nothing in THIS suite is about the
  // dialer, but the request still has to be answered with a shape the SDK
  // accepts, or `new Device(undefined)` throws and takes the whole render down.
  if (url.endsWith('/calls/voice-token')) {
    return { token: 'fake-voice-token', identity: 'user-1', ttlSeconds: 3600 }
  }
  if (method === 'GET') {
    const drafts = draftsByOrg.get(orgOf(url)) ?? []
    return { drafts, total: drafts.length }
  }
  if (method === 'POST') {
    created += 1
    return { draft: makeDraft({ id: `draft-${created}` }) }
  }
  if (method === 'PATCH') {
    const patch = JSON.parse(String(init?.body ?? '{}')) as Partial<EmailDraft>
    return { draft: makeDraft({ id: draftIdOf(url), ...patch }) }
  }
  const id = draftIdOf(url)
  if (deleted.has(id)) throw new ApiError('Draft not found', 404)
  deleted.add(id)
  return { draft: { id } }
}

function callsWithMethod(method: string) {
  return jsonFetch.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method)
}

/** Reads the provider and exposes one button per action, so a click is a test. */
function Probe() {
  const { drafts, openDrafts, keptDrafts, closeCard, discardDraft, reopenCard } =
    useComposer()

  return (
    <div>
      <p>{`open ${openDrafts.length}`}</p>
      <p>{`kept ${keptDrafts.length}`}</p>
      <ul>
        {drafts.map((draft) => (
          <li key={draft.id}>
            <span>{draft.id}</span>
            <button type="button" onClick={() => void closeCard(draft.id)}>{`close ${draft.id}`}</button>
            <button type="button" onClick={() => void reopenCard(draft.id)}>{`reopen ${draft.id}`}</button>
            <button type="button" onClick={() => void discardDraft(draft.id)}>
              {`discard ${draft.id}`}
            </button>
          </li>
        ))}
      </ul>
      <label htmlFor="subject">Subject</label>
      <input id="subject" />
    </div>
  )
}

function renderProvider(client: QueryClient = makeTestQueryClient()) {
  const ui = () => withProviders(<ComposerProvider><Probe /></ComposerProvider>, { client })
  const view = render(ui())
  return { ...view, rerenderProvider: () => view.rerender(ui()) }
}

beforeEach(() => {
  // jsdom's own default (1024 px) sits below `LG_BREAKPOINT_PX` (1204 px,
  // MAI-209 → `desktopOnly.ts`), which would hide the dock in every test here
  // that mounts the real `ProtectedLayout` and expects to find a real,
  // expanded `ComposerCard`. A plain desktop width is what these tests are
  // actually meant to run at.
  window.innerWidth = 1440
  created = 0
  draftsByOrg.clear()
  deleted.clear()
  jsonFetch.mockReset()
  toastErrorMock.mockReset()
  jsonFetch.mockImplementation((url: string, init?: RequestInit) => {
    try {
      return Promise.resolve(serve(url, init))
    } catch (err) {
      return Promise.reject(err)
    }
  })
  useAuthMock.mockReturnValue({ org: { id: 'org-1' } })
})

describe('ComposerProvider', () => {
  it('opens a card when the rep presses c', async () => {
    const user = userEvent.setup()
    renderProvider()

    await user.keyboard('c')

    await screen.findByText('draft-1')
    expect(screen.getByText('open 1')).toBeInTheDocument()
    expect(callsWithMethod('POST')).toHaveLength(1)
  })

  it('types the letter c instead of opening a card when the rep is in a field', async () => {
    const user = userEvent.setup()
    renderProvider()

    await user.click(screen.getByLabelText('Subject'))
    await user.keyboard('c')

    expect(screen.getByLabelText('Subject')).toHaveValue('c')
    expect(callsWithMethod('POST')).toHaveLength(0)
    expect(screen.getByText('open 0')).toBeInTheDocument()
  })

  it('ignores c with a modifier held, because that is a browser shortcut', async () => {
    const user = userEvent.setup()
    renderProvider()

    await user.keyboard('{Meta>}c{/Meta}')
    await user.keyboard('{Control>}c{/Control}')

    expect(callsWithMethod('POST')).toHaveLength(0)
  })

  it('lands two cards on two quick presses, because openComposer awaits each create', async () => {
    const user = userEvent.setup()
    renderProvider()

    await user.keyboard('cc')

    await waitFor(() => expect(screen.getByText('open 2')).toBeInTheDocument())
    expect(callsWithMethod('POST')).toHaveLength(2)
    expect(screen.getByText('draft-1')).toBeInTheDocument()
    expect(screen.getByText('draft-2')).toBeInTheDocument()
  })

  it('merges the first load into local state, keeping a card opened before it returned', async () => {
    // The GET is held open on purpose: this is the race the merge exists for.
    let releaseList: (value: unknown) => void = () => {}
    jsonFetch.mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return new Promise((resolve) => {
          releaseList = resolve
        })
      }
      return Promise.resolve(serve(url, init))
    })

    const user = userEvent.setup()
    renderProvider()

    await user.keyboard('c')
    await screen.findByText('draft-1')

    releaseList({ drafts: [makeDraft({ id: 'server-draft' })], total: 1 })

    // Both survive. A plain assignment here would wipe the card the rep just
    // opened, which is the whole reason the effect merges.
    await screen.findByText('server-draft')
    expect(screen.getByText('draft-1')).toBeInTheDocument()
    expect(screen.getByText('open 2')).toBeInTheDocument()
  })

  it('empties the dock and re-hydrates when the rep switches orgs', async () => {
    draftsByOrg.set('org-1', [makeDraft({ id: 'org-1-draft' })])
    draftsByOrg.set('org-2', [makeDraft({ id: 'org-2-draft' })])

    const { rerenderProvider } = renderProvider()
    await screen.findByText('org-1-draft')

    useAuthMock.mockReturnValue({ org: { id: 'org-2' } })
    rerenderProvider()

    await screen.findByText('org-2-draft')
    expect(screen.queryByText('org-1-draft')).not.toBeInTheDocument()
    expect(screen.getByText('open 1')).toBeInTheDocument()
  })

  it('closes a card with a save, never a delete', async () => {
    const user = userEvent.setup()
    renderProvider()

    await user.keyboard('c')
    await screen.findByText('draft-1')
    await user.click(screen.getByRole('button', { name: 'close draft-1' }))

    await waitFor(() => expect(callsWithMethod('PATCH')).toHaveLength(1))
    expect(jsonFetch).toHaveBeenCalledWith('/api/email/orgs/org-1/drafts/draft-1', {
      method: 'PATCH',
      body: JSON.stringify({ isOpen: false }),
    })
    expect(callsWithMethod('DELETE')).toHaveLength(0)
    // Out of the dock, still kept: the "3 drafts" button is the way back to it.
    expect(screen.getByText('open 0')).toBeInTheDocument()
    expect(screen.getByText('kept 1')).toBeInTheDocument()
  })

  it('reopens a kept draft expanded', async () => {
    draftsByOrg.set('org-1', [makeDraft({ id: 'kept-draft', isOpen: false })])

    const user = userEvent.setup()
    renderProvider()
    await screen.findByText('kept 1')

    await user.click(screen.getByRole('button', { name: 'reopen kept-draft' }))

    await waitFor(() => expect(screen.getByText('open 1')).toBeInTheDocument())
    expect(jsonFetch).toHaveBeenCalledWith('/api/email/orgs/org-1/drafts/kept-draft', {
      method: 'PATCH',
      body: JSON.stringify({ isOpen: true }),
    })
  })


  it('deletes only on discard, and drops the card straight away', async () => {
    const user = userEvent.setup()
    renderProvider()

    await user.keyboard('c')
    await screen.findByText('draft-1')
    await user.click(screen.getByRole('button', { name: 'discard draft-1' }))

    await waitFor(() => expect(screen.getByText('open 0')).toBeInTheDocument())
    expect(jsonFetch).toHaveBeenCalledWith('/api/email/orgs/org-1/drafts/draft-1', {
      method: 'DELETE',
    })
    expect(screen.queryByText('draft-1')).not.toBeInTheDocument()
  })

  it('shows the server own message when opening a card fails', async () => {
    const { ApiError } = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
    jsonFetch.mockImplementation((url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST') {
        return Promise.reject(
          new ApiError('You have 12 composers open. Close or discard one before starting another.', 409),
        )
      }
      return Promise.resolve(serve(url, init))
    })

    const user = userEvent.setup()
    renderProvider()

    await user.keyboard('c')

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        'You have 12 composers open. Close or discard one before starting another.',
      ),
    )
    expect(screen.getByText('open 0')).toBeInTheDocument()
  })

  it('does nothing at all before the rep has an org', async () => {
    useAuthMock.mockReturnValue({ org: null })
    const user = userEvent.setup()
    renderProvider()

    await user.keyboard('c')

    expect(jsonFetch).not.toHaveBeenCalled()
    expect(screen.getByText('open 0')).toBeInTheDocument()
  })
})

describe('useComposer outside the provider', () => {
  function Bare() {
    useComposer()
    return null
  }

  function Optional() {
    return <p>{useComposerOptional() === null ? 'no composer' : 'composer'}</p>
  }

  it('throws, so a dead card reads as a missing provider', () => {
    // React re-throws the render error to the console before rethrowing it here.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(withProviders(<Bare />))).toThrow('useComposer must be used inside <ComposerProvider>.')
    consoleError.mockRestore()
  })

  it('returns null from useComposerOptional, for components that also render in tests', () => {
    render(withProviders(<Optional />))
    expect(screen.getByText('no composer')).toBeInTheDocument()
  })
})

describe('mounted in ProtectedLayout', () => {
  function Page({ name, to }: { name: string; to: string }) {
    const composer = useComposerOptional()
    return (
      <div>
        <p>{name}</p>
        <p>{`cards ${composer?.openDrafts.length ?? 'none'}`}</p>
        <Link to={to}>{`go to ${to}`}</Link>
      </div>
    )
  }

  it('keeps the card through a route change, because the provider is outside the Outlet', async () => {
    useAuthMock.mockReturnValue({
      org: { id: 'org-1' },
      isLoading: false,
      isAuthenticated: true,
      needsOnboarding: false,
      needsOrg: false,
    })

    const user = userEvent.setup()
    render(
      withProviders(
        <Routes>
          <Route path="/" element={<ProtectedLayout />}>
            <Route path="home" element={<Page name="home page" to="/team" />} />
            <Route path="team" element={<Page name="team page" to="/home" />} />
          </Route>
        </Routes>,
        { initialEntries: ['/home'] },
      ),
    )

    await user.keyboard('c')
    await screen.findByText('cards 1')

    await user.click(screen.getByRole('link', { name: 'go to /team' }))
    await screen.findByText('team page')

    // Still one card, and only one POST: the provider never unmounted, so the
    // half-written email survived the navigation.
    expect(screen.getByText('cards 1')).toBeInTheDocument()
    expect(callsWithMethod('POST')).toHaveLength(1)
  })

  it('sends one DELETE when the rep double-clicks the discard confirmation', async () => {
    useAuthMock.mockReturnValue({
      org: { id: 'org-1' },
      isLoading: false,
      isAuthenticated: true,
      needsOnboarding: false,
      needsOrg: false,
    })

    const user = userEvent.setup()
    render(
      withProviders(
        <Routes>
          <Route path="/" element={<ProtectedLayout />}>
            <Route path="home" element={<Page name="home page" to="/team" />} />
          </Route>
        </Routes>,
        { initialEntries: ['/home'] },
      ),
    )

    await user.keyboard('c')
    await screen.findByLabelText('Message')

    await user.click(screen.getByRole('button', { name: 'Discard draft' }))
    const confirm = await screen.findByRole('button', { name: 'Discard' })

    // Both activations land before the render that closes the dialog, which is
    // what a double-click on the confirm is. Unguarded, the second one sent a
    // DELETE for a row the first had already destroyed: a 404 the rep read as
    // "Draft not found", over a card the invalidate-on-error resync put back.
    await act(async () => {
      confirm.click()
      confirm.click()
    })

    await waitFor(() => expect(screen.getByText('cards 0')).toBeInTheDocument())
    expect(callsWithMethod('DELETE')).toHaveLength(1)
    expect(toastErrorMock).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument()
  })
})
