import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { Settings_Integrations_ProviderMark } from './Settings_Integrations_ProviderMark'

describe('Settings_Integrations_ProviderMark', () => {
  it('renders the Google logo with the full product name in its alt text', () => {
    render(<Settings_Integrations_ProviderMark provider="google" label="Google Workspace" />)
    const img = screen.getByAltText('Google Workspace logo')
    expect(img.tagName).toBe('IMG')
    expect(img).toHaveAttribute('src', expect.stringContaining('google'))
  })

  it('renders the Microsoft logo with the full product name in its alt text', () => {
    render(<Settings_Integrations_ProviderMark provider="microsoft" label="Microsoft 365" />)
    const img = screen.getByAltText('Microsoft 365 logo')
    expect(img.tagName).toBe('IMG')
    expect(img).toHaveAttribute('src', expect.stringContaining('microsoft'))
  })

  it('renders a different image for each provider', () => {
    const { rerender } = render(
      <Settings_Integrations_ProviderMark provider="google" label="Google Workspace" />,
    )
    const googleSrc = screen.getByAltText('Google Workspace logo').getAttribute('src')

    rerender(<Settings_Integrations_ProviderMark provider="microsoft" label="Microsoft 365" />)
    const microsoftSrc = screen.getByAltText('Microsoft 365 logo').getAttribute('src')

    expect(googleSrc).not.toEqual(microsoftSrc)
  })
})
