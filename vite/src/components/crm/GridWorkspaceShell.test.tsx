import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { GridWorkspaceShell } from './GridWorkspaceShell'

describe('GridWorkspaceShell', () => {
  it('keeps the page header and view bar stable around one flexible grid canvas', () => {
    render(
      <GridWorkspaceShell
        header={<header>People</header>}
        viewBar={<button type="button">Default view</button>}
        recordCount={<output>12 records</output>}
      >
        <div role="grid" aria-label="People grid" />
      </GridWorkspaceShell>,
    )

    const workspace = screen.getByTestId('grid-workspace')
    const canvas = screen.getByTestId('grid-workspace-canvas')

    expect(workspace).toHaveClass('flex', 'min-h-0', 'flex-1', 'flex-col', 'overflow-hidden')
    expect(screen.getByRole('region', { name: 'View bar' })).toContainElement(screen.getByText('12 records'))
    expect(canvas).toHaveClass('min-h-0', 'flex-1', 'overflow-hidden')
    expect(canvas).toContainElement(screen.getByRole('grid', { name: 'People grid' }))
  })

  it('does not reserve an empty view bar', () => {
    render(
      <GridWorkspaceShell header={<header>People</header>}>
        <div role="grid" aria-label="People grid" />
      </GridWorkspaceShell>,
    )

    expect(screen.queryByRole('region', { name: 'View bar' })).not.toBeInTheDocument()
  })
})
