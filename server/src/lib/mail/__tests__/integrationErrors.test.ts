// Unit tests for integrationErrors.ts — the stable OAuth error-code table.
//
// What these protect:
//   - the code table is the closed API the client keys off: every entry is a
//     lowercase snake_case string with no provider name buried in it, and the
//     spec's required codes are all present
//   - mapProviderError collapses each provider's dialect onto that vocabulary and
//     NEVER hands back the raw provider string — Google's admin_policy_enforced and
//     Microsoft's AADSTS65001 both land on admin_approval_required
//   - an unmapped error is `unknown` AND logs exactly one line carrying the raw
//     code, because that log line is how the table grows from real traffic
//
// The logger is mocked so the one unknown-path log line can be asserted.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../../../dependencies/logger.js', () => ({ logger: loggerMock }))

import { INTEGRATION_ERROR_CODES, mapProviderError } from '../integrationErrors.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('INTEGRATION_ERROR_CODES', () => {
  // The spec (§ Acceptance criteria 10, MAI-98) names the codes that MUST exist.
  // The client's ERROR_CODE_RECOVERY is written against these exact strings.
  const REQUIRED = [
    'partial_access',
    'token_revoked',
    'missing_refresh_token',
    'admin_approval_required',
    'user_cancelled',
    'state_invalid',
    'token_exchange_failed',
    'identity_fetch_failed',
    'token_unreadable',
    'provider_unreachable',
    'redirect_uri_mismatch',
    'client_secret_invalid',
    'unknown',
  ] as const

  it.each(REQUIRED)('includes the required code %s', (code) => {
    expect(INTEGRATION_ERROR_CODES).toContain(code)
  })

  it('is a set of unique codes', () => {
    expect(new Set(INTEGRATION_ERROR_CODES).size).toBe(INTEGRATION_ERROR_CODES.length)
  })

  it('is every code lowercase snake_case with no provider name in it', () => {
    // A code is shared by both providers, so a provider name in one would be a lie
    // on the other. Guard the shape and the neutrality in one assertion.
    for (const code of INTEGRATION_ERROR_CODES) {
      expect(code).toMatch(/^[a-z]+(?:_[a-z]+)*$/)
      expect(code).not.toMatch(/google|microsoft|gmail|outlook|graph|aadsts|azure/)
    }
  })
})

describe('mapProviderError', () => {
  it('maps Microsoft AADSTS65001 to admin_approval_required', () => {
    expect(mapProviderError('microsoft', 'AADSTS65001')).toBe('admin_approval_required')
  })

  it('maps Google admin_policy_enforced to admin_approval_required', () => {
    expect(mapProviderError('google', 'admin_policy_enforced')).toBe('admin_approval_required')
  })

  it('maps access_denied to user_cancelled for either provider', () => {
    expect(mapProviderError('google', 'access_denied')).toBe('user_cancelled')
    expect(mapProviderError('microsoft', 'access_denied')).toBe('user_cancelled')
  })

  it('finds an AADSTS code embedded in a longer error_description', () => {
    const raw =
      'AADSTS65001: The user or administrator has not consented to use the application.'
    expect(mapProviderError('microsoft', raw)).toBe('admin_approval_required')
  })

  it('maps the standard OAuth invalid_grant to token_revoked', () => {
    expect(mapProviderError('google', 'invalid_grant')).toBe('token_revoked')
    expect(mapProviderError('microsoft', 'invalid_grant')).toBe('token_revoked')
  })

  it('maps redirect and client-secret failures to their own codes', () => {
    expect(mapProviderError('microsoft', 'AADSTS50011')).toBe('redirect_uri_mismatch')
    expect(mapProviderError('microsoft', 'AADSTS7000215')).toBe('client_secret_invalid')
    expect(mapProviderError('google', 'redirect_uri_mismatch')).toBe('redirect_uri_mismatch')
    expect(mapProviderError('google', 'invalid_client')).toBe('client_secret_invalid')
  })

  it('only ever returns a code from the table, never a raw provider string', () => {
    const raws = [
      'AADSTS65001',
      'admin_policy_enforced',
      'access_denied',
      'invalid_grant',
      'AADSTS50011',
      'something_nobody_has_seen',
    ]
    for (const provider of ['google', 'microsoft'] as const) {
      for (const raw of raws) {
        const code = mapProviderError(provider, raw)
        expect(INTEGRATION_ERROR_CODES).toContain(code)
        expect(code).not.toBe(raw)
      }
    }
  })

  describe('the unknown path', () => {
    it('maps an invented error to unknown and logs exactly one line with the raw code', () => {
      const code = mapProviderError('google', 'flibbertigibbet_error')

      expect(code).toBe('unknown')
      expect(loggerMock.warn).toHaveBeenCalledTimes(1)

      const [fields, message] = loggerMock.warn.mock.calls[0] as [
        Record<string, unknown>,
        string,
      ]
      expect(fields.provider).toBe('google')
      expect(fields.rawErrorCode).toBe('flibbertigibbet_error')
      expect(message).toContain('unknown')
    })

    it('does not log on a mapped error', () => {
      mapProviderError('microsoft', 'AADSTS65001')
      expect(loggerMock.warn).not.toHaveBeenCalled()
    })

    it('treats an empty raw string as unknown and logs it', () => {
      expect(mapProviderError('microsoft', '')).toBe('unknown')
      expect(loggerMock.warn).toHaveBeenCalledTimes(1)
    })
  })
})
