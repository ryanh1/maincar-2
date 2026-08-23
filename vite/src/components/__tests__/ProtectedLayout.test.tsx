import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'

import { renderWithProviders } from '@/test/utils'

// The canonical shape for a component test here: vi.hoisted() makes the mock fns,
// vi.mock() swaps the modules, and the component is imported AFTER both so the
// mocks are in place when its module graph loads.
const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }))

vi.mock('@/providers/useAuth', () => ({ useAuth: useAuthMock }))
vi.mock('@/components/Sidebar', () => ({ Sidebar: () => <nav>sidebar</nav> }))

import { ProtectedLayout } from '@/components/ProtectedLayout'

function renderAt(path: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<ProtectedLayout />}>
        <Route path="home" element={<p>home page</p>} />
        <Route path="welcome" element={<p>welcome page</p>} />
        <Route path="create-org" element={<p>create org page</p>} />
      </Route>
      <Route path="/auth/sign-in" element={<p>sign in page</p>} />
    </Routes>,
    { initialEntries: [path] },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  window.innerWidth = 1440
  window.dispatchEvent(new Event('resize'))
})

describe('ProtectedLayout', () => {
  it('shows the loader while auth is still resolving', () => {
    useAuthMock.mockReturnValue({ isLoading: true, isAuthenticated: false, needsOnboarding: false, needsOrg: false })

    renderAt('/home')

    expect(screen.getByLabelText('Loading')).toBeInTheDocument()
    expect(screen.queryByText('home page')).not.toBeInTheDocument()
  })

  it('redirects a signed-out visitor to sign-in', () => {
    useAuthMock.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      needsOnboarding: false,
      needsOrg: false,
    })

    renderAt('/home')

    expect(screen.getByText('sign in page')).toBeInTheDocument()
  })

  it('renders the page for a signed-in user who finished onboarding', () => {
    useAuthMock.mockReturnValue({ isLoading: false, isAuthenticated: true, needsOnboarding: false, needsOrg: false })

    renderAt('/home')

    expect(screen.getByText('home page')).toBeInTheDocument()
  })

  it('reserves the desktop rail and expands the same right inset with the dialer', () => {
    useAuthMock.mockReturnValue({ isLoading: false, isAuthenticated: true, needsOnboarding: false, needsOrg: false })

    renderAt('/home')

    const shell = document.querySelector<HTMLElement>('[data-outreach-layout="rail"]')
    expect(shell).toHaveStyle({ paddingRight: '64px', paddingBottom: '0px' })
    fireEvent.click(screen.getByRole('button', { name: 'Open the dialer' }))
    expect(shell).toHaveStyle({ paddingRight: '384px' })
  })

  it('reserves the mobile bottom bar instead of desktop rail space', () => {
    window.innerWidth = 375
    useAuthMock.mockReturnValue({ isLoading: false, isAuthenticated: true, needsOnboarding: false, needsOrg: false })

    renderAt('/home')

    expect(document.querySelector('[data-outreach-layout="bottom"]')).toHaveStyle({
      paddingRight: '0px',
      paddingBottom: '48px',
    })
  })

  it('forces an unonboarded user to /welcome', () => {
    useAuthMock.mockReturnValue({ isLoading: false, isAuthenticated: true, needsOnboarding: true, needsOrg: true })

    renderAt('/home')

    expect(screen.getByText('welcome page')).toBeInTheDocument()
    expect(screen.queryByText('home page')).not.toBeInTheDocument()
  })

  it('lets an unonboarded user stay on /welcome, so the redirect cannot loop', () => {
    useAuthMock.mockReturnValue({ isLoading: false, isAuthenticated: true, needsOnboarding: true, needsOrg: true })

    renderAt('/welcome')

    expect(screen.getByText('welcome page')).toBeInTheDocument()
  })

  // Onboarding is two steps and the order matters: the name is asked for first,
  // so an invitee's profile is complete before the invite lands them anywhere.
  it('sends a named user with no org to /create-org', () => {
    useAuthMock.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      needsOnboarding: false,
      needsOrg: true,
    })

    renderAt('/home')

    expect(screen.getByText('create org page')).toBeInTheDocument()
    expect(screen.queryByText('home page')).not.toBeInTheDocument()
  })

  it('asks for the name before the org, never the other way round', () => {
    useAuthMock.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      needsOnboarding: true,
      needsOrg: true,
    })

    renderAt('/home')

    expect(screen.getByText('welcome page')).toBeInTheDocument()
    expect(screen.queryByText('create org page')).not.toBeInTheDocument()
  })

  it('lets an org-less user stay on /create-org, so the redirect cannot loop', () => {
    useAuthMock.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      needsOnboarding: false,
      needsOrg: true,
    })

    renderAt('/create-org')

    expect(screen.getByText('create org page')).toBeInTheDocument()
  })

  // An invitee has an org the moment they accept, so both screens are finished
  // asking and neither should hold them there.
  it('bounces a fully onboarded user off /create-org', () => {
    useAuthMock.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
      needsOnboarding: false,
      needsOrg: false,
    })

    renderAt('/create-org')

    expect(screen.getByText('home page')).toBeInTheDocument()
  })
})
