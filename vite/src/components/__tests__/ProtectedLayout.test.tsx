import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
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
      </Route>
      <Route path="/auth/sign-in" element={<p>sign in page</p>} />
    </Routes>,
    { initialEntries: [path] },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProtectedLayout', () => {
  it('shows the loader while auth is still resolving', () => {
    useAuthMock.mockReturnValue({ isLoading: true, isAuthenticated: false, needsOnboarding: false })

    renderAt('/home')

    expect(screen.getByLabelText('Loading')).toBeInTheDocument()
    expect(screen.queryByText('home page')).not.toBeInTheDocument()
  })

  it('redirects a signed-out visitor to sign-in', () => {
    useAuthMock.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
      needsOnboarding: false,
    })

    renderAt('/home')

    expect(screen.getByText('sign in page')).toBeInTheDocument()
  })

  it('renders the page for a signed-in user who finished onboarding', () => {
    useAuthMock.mockReturnValue({ isLoading: false, isAuthenticated: true, needsOnboarding: false })

    renderAt('/home')

    expect(screen.getByText('home page')).toBeInTheDocument()
  })

  it('forces an unonboarded user to /welcome', () => {
    useAuthMock.mockReturnValue({ isLoading: false, isAuthenticated: true, needsOnboarding: true })

    renderAt('/home')

    expect(screen.getByText('welcome page')).toBeInTheDocument()
    expect(screen.queryByText('home page')).not.toBeInTheDocument()
  })

  it('lets an unonboarded user stay on /welcome, so the redirect cannot loop', () => {
    useAuthMock.mockReturnValue({ isLoading: false, isAuthenticated: true, needsOnboarding: true })

    renderAt('/welcome')

    expect(screen.getByText('welcome page')).toBeInTheDocument()
  })
})
