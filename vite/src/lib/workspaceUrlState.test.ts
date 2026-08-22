import { describe, expect, it } from 'vitest'

import {
  decodeWorkspaceUrlState,
  encodeWorkspaceUrlState,
  legacySettingsPath,
  settingsPath,
} from './workspaceUrlState'

describe('workspaceUrlState', () => {
  it('round-trips only safe navigation, selected-record, and layout state', () => {
    const encoded = encodeWorkspaceUrlState({
      activeViewId: 'pipeline',
      selectedRecordId: 'record_123',
      viewConfig: {
        sorts: [{ attributeId: 'createdAt', direction: 'desc' }],
        teamScope: { teamIds: ['team_sales'] },
        layout: {
          columns: [{ attributeId: 'company', visible: true, order: 0 }],
          rowHeight: 'comfortable',
          gridLines: false,
          frozenRows: 1,
          frozenCols: 2,
          zoom: 110,
          columnWidths: { company: 240 },
        },
      },
    })

    expect(decodeWorkspaceUrlState(encoded)).toEqual({
      activeViewId: 'pipeline',
      selectedRecordId: 'record_123',
      viewConfig: {
        sorts: [{ attributeId: 'createdAt', direction: 'desc' }],
        teamScope: { teamIds: ['team_sales'] },
        layout: {
          columns: [{ attributeId: 'company', visible: true, order: 0 }],
          rowHeight: 'comfortable',
          gridLines: false,
          frozenRows: 1,
          frozenCols: 2,
          zoom: 110,
          columnWidths: { company: 240 },
        },
      },
    })
  })

  it('rejects an attempted search or filter literal before it can reach a URL', () => {
    expect(() => encodeWorkspaceUrlState({
      activeViewId: 'pipeline',
      search: 'maria@example.com',
      filter: { phone: '+15551234567' },
    } as unknown as Parameters<typeof encodeWorkspaceUrlState>[0])).toThrow(/not permitted/i)
  })

  it('uses path segments for canonical Settings destinations and redirects legacy tabs', () => {
    expect(settingsPath('call-recordings')).toBe('/settings/call-recordings')
    expect(legacySettingsPath('call-recordings')).toBe('/settings/call-recordings')
    expect(legacySettingsPath('not-a-section')).toBe('/settings/profile')
  })
})
