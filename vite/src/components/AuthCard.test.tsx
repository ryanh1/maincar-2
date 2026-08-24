import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { renderWithProviders } from '@/test/utils'

import { AuthCard } from './AuthCard'

describe('AuthCard', () => {
  it('renders the title as a heading and the children below it', () => {
    renderWithProviders(
      <AuthCard title="Sign in">
        <p>form goes here</p>
      </AuthCard>,
    )

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText('form goes here')).toBeInTheDocument()
  })

  it('renders no heading when no title is given', () => {
    renderWithProviders(
      <AuthCard>
        <p>Loading…</p>
      </AuthCard>,
    )

    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('renders an optional subtitle and footer', () => {
    renderWithProviders(
      <AuthCard title="Sign in" subtitle="Welcome" footer="footer text">
        <p>form</p>
      </AuthCard>,
    )

    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(screen.getByText('footer text')).toBeInTheDocument()
  })
})
