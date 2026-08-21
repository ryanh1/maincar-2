import { describe, expect, it } from 'vitest'

import {
  ERROR_CODE_RECOVERY,
  INTEGRATION_ERROR_CODES,
  OAUTH_MESSAGE_TYPE,
  PRE_CONNECT_NOTES,
  isOAuthPopupMessage,
  preConnectNotesFor,
  recoveryFor,
  type OAuthPopupMessage,
} from '@/lib/integrationTypes'
import { queryKeys } from '@/lib/queryKeys'

describe('ERROR_CODE_RECOVERY', () => {
  it('has an entry for every code, and no code the error set does not define', () => {
    // The two tables cannot drift: the recovery keys are EXACTLY the error codes.
    const codes = [...INTEGRATION_ERROR_CODES].sort()
    const recoveryKeys = Object.keys(ERROR_CODE_RECOVERY).sort()
    expect(recoveryKeys).toEqual(codes)
  })

  it('includes an `unknown` entry so an unseen code still renders a block', () => {
    expect(ERROR_CODE_RECOVERY.unknown).toBeDefined()
    expect(ERROR_CODE_RECOVERY.unknown.fixes.length).toBeGreaterThan(0)
  })

  it('gives every code a non-empty title and at least one fix', () => {
    for (const code of INTEGRATION_ERROR_CODES) {
      const entry = ERROR_CODE_RECOVERY[code]
      expect(entry.title.trim(), code).not.toBe('')
      expect(entry.fixes.length, code).toBeGreaterThan(0)
      for (const fix of entry.fixes) {
        expect(fix.trim(), code).not.toBe('')
      }
    }
  })

  it('never says "workspace" — the tenant is an "organization"', () => {
    for (const code of INTEGRATION_ERROR_CODES) {
      const entry = ERROR_CODE_RECOVERY[code]
      const strings = [entry.title, ...entry.fixes].join(' ').toLowerCase()
      expect(strings, code).not.toContain('workspace')
    }
  })
})

describe('recoveryFor', () => {
  it('returns the entry for a known code', () => {
    expect(recoveryFor('token_revoked')).toBe(ERROR_CODE_RECOVERY.token_revoked)
  })

  it('falls back to `unknown` for an unrecognised code', () => {
    // A code the client has never seen still renders a block.
    expect(recoveryFor('brand_new_code' as never)).toBe(ERROR_CODE_RECOVERY.unknown)
  })

  it('falls back to `unknown` for null and undefined', () => {
    expect(recoveryFor(null)).toBe(ERROR_CODE_RECOVERY.unknown)
    expect(recoveryFor(undefined)).toBe(ERROR_CODE_RECOVERY.unknown)
  })
})

describe('PRE_CONNECT_NOTES', () => {
  it('carries the two Google notes and the Microsoft note', () => {
    const google = preConnectNotesFor('google')
    const microsoft = preConnectNotesFor('microsoft')

    expect(google).toContain(
      'Google warns that this app is not verified. Choose Advanced, then continue.',
    )
    expect(google).toContain(
      'If you see "Access blocked", your Google Workspace admin must allow Maincar in Security → API controls.',
    )
    expect(microsoft).toContain(
      'If you see "Need admin approval", your Microsoft 365 admin must approve Maincar first.',
    )
  })

  it('ties every note to a real provider', () => {
    for (const note of PRE_CONNECT_NOTES) {
      expect(['google', 'microsoft']).toContain(note.provider)
      expect(note.note.trim()).not.toBe('')
    }
  })
})

describe('isOAuthPopupMessage', () => {
  const valid: OAuthPopupMessage = {
    type: OAUTH_MESSAGE_TYPE,
    provider: 'google',
    ok: true,
    status: 'connected',
    errorCode: null,
    statusDetail: '',
    emailAddress: 'rep@example.com',
  }

  it('accepts a well-formed message', () => {
    expect(isOAuthPopupMessage(valid)).toBe(true)
  })

  it('accepts a limited result with an error code and null email', () => {
    expect(
      isOAuthPopupMessage({
        ...valid,
        ok: false,
        status: 'limited',
        errorCode: 'partial_access',
        emailAddress: null,
      }),
    ).toBe(true)
  })

  it('rejects a foreign message with the wrong type', () => {
    expect(isOAuthPopupMessage({ ...valid, type: 'react-devtools' })).toBe(false)
  })

  it('rejects a status outside the closed set', () => {
    expect(isOAuthPopupMessage({ ...valid, status: 'pending' })).toBe(false)
  })

  it('rejects a non-boolean ok', () => {
    expect(isOAuthPopupMessage({ ...valid, ok: 'yes' })).toBe(false)
  })

  it('rejects a provider that is neither known nor null', () => {
    expect(isOAuthPopupMessage({ ...valid, provider: 'yahoo' })).toBe(false)
  })

  it('rejects primitives and null', () => {
    expect(isOAuthPopupMessage(null)).toBe(false)
    expect(isOAuthPopupMessage('maincar:oauth-result')).toBe(false)
    expect(isOAuthPopupMessage(undefined)).toBe(false)
  })
})

describe('queryKeys.integrations', () => {
  it('keys all, list, and health by org', () => {
    expect(queryKeys.integrations.all('org1')).toEqual(['integrations', 'org1'])
    expect(queryKeys.integrations.list('org1')).toEqual(['integrations', 'org1', 'list'])
    expect(queryKeys.integrations.health('org1')).toEqual(['integrations', 'org1', 'health'])
  })

  it('makes all(orgId) a prefix of list and health, so invalidating it hits both', () => {
    const all = queryKeys.integrations.all('org1')
    const list = queryKeys.integrations.list('org1')
    const health = queryKeys.integrations.health('org1')
    expect(list.slice(0, all.length)).toEqual([...all])
    expect(health.slice(0, all.length)).toEqual([...all])
  })

  it('keys a different org to a different entry', () => {
    expect(queryKeys.integrations.list('org1')).not.toEqual(queryKeys.integrations.list('org2'))
  })
})
