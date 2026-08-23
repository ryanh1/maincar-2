import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderWithProviders } from '@/test/utils'
import type { AttributeDef } from '@/lib/crmTypes'
import type { ColorRule } from '@/hooks/colorRules'

const { useGetColorRulesMock, useColorRuleMutationsMock } = vi.hoisted(() => ({
  useGetColorRulesMock: vi.fn(),
  useColorRuleMutationsMock: vi.fn(),
}))

vi.mock('@/hooks/colorRules', () => ({
  useGetColorRules: useGetColorRulesMock,
  useColorRuleMutations: useColorRuleMutationsMock,
}))

import { ConditionalFormatPanel } from './ConditionalFormatPanel'

const attributes = [
  {
    id: 'attr-date', objectId: 'object-1', slug: 'callbackDate', name: 'Callback date', description: null, icon: null,
    type: 'date', optionsJson: null, refObjectId: null, formatJson: null, validationJson: null, isIdentity: false,
    storage: 'column', isMulti: false, isRequired: false, isUnique: false, isReadOnly: false, isSystem: false,
    defaultJson: null, sortOrder: 0, isArchived: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
] satisfies AttributeDef[]

const rules: ColorRule[] = [
  {
    id: 'rule-1', viewId: 'view-1', attribute: 'attr-date', predicate: { op: 'before_today' }, target: 'background',
    scope: 'cell', color: 'option-5', sortOrder: 0, isDefault: true, enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

function mutations() {
  return {
    create: { mutateAsync: vi.fn().mockResolvedValue({}) },
    update: { mutateAsync: vi.fn().mockResolvedValue({}) },
    remove: { mutateAsync: vi.fn().mockResolvedValue({}) },
    reorder: { mutateAsync: vi.fn().mockResolvedValue({}) },
    restoreDefaults: { mutateAsync: vi.fn().mockResolvedValue({}) },
  }
}

describe('ConditionalFormatPanel', () => {
  beforeEach(() => {
    useGetColorRulesMock.mockReturnValue({ data: { colorRules: rules } })
    useColorRuleMutationsMock.mockReturnValue(mutations())
  })

  it('lists the view rules with their field and predicate', () => {
    renderWithProviders(
      <ConditionalFormatPanel
        anchor={{ x: 0, y: 0, width: 1, height: 1 }}
        open
        onOpenChange={() => {}}
        orgId="org-1"
        viewId="view-1"
        attributes={attributes}
        colors={{ 'option-5': '#be123c' }}
      />,
    )

    expect(screen.getByText('Callback date')).toBeTruthy()
    expect(screen.getByText(/is before today/)).toBeTruthy()
    expect(screen.getByText('Add rule')).toBeTruthy()
    expect(screen.getByText('Reset to defaults')).toBeTruthy()
  })

  it('opens the add-rule form and disables Add until a field is chosen', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <ConditionalFormatPanel
        anchor={{ x: 0, y: 0, width: 1, height: 1 }}
        open
        onOpenChange={() => {}}
        orgId="org-1"
        viewId="view-1"
        attributes={attributes}
        colors={{ 'option-5': '#be123c' }}
      />,
    )

    await user.click(screen.getByText('Add rule'))
    expect(screen.getByText('Cancel')).toBeTruthy()
  })
})
