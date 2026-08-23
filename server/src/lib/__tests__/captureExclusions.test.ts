import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CAPTURE_SETTINGS,
  evaluateCaptureExclusions,
  type CaptureSettings,
} from '../captureExclusions.js'

function settings(overrides: Partial<CaptureSettings> = {}): CaptureSettings {
  return { ...DEFAULT_CAPTURE_SETTINGS, ...overrides }
}

function input(overrides: Partial<Parameters<typeof evaluateCaptureExclusions>[1]> = {}) {
  return {
    participants: [{ address: 'jane@acme.com' }],
    activityType: 'email' as const,
    ...overrides,
  }
}

describe('evaluateCaptureExclusions', () => {
  it('lets a normal message through with its participants intact', () => {
    const result = evaluateCaptureExclusions(settings(), input())
    expect(result).toEqual({
      excluded: false,
      exclusion: null,
      eligibleParticipants: [{ address: 'jane@acme.com' }],
    })
  })

  it('excludes a mailbox whose owner opted out', () => {
    const result = evaluateCaptureExclusions(settings(), input({ optedOut: true }))
    expect(result.excluded).toBe(true)
    expect(result.exclusion).toBe('user_opt_out')
  })

  it('excludes an activity type the org does not log', () => {
    const result = evaluateCaptureExclusions(
      settings({ logActivityTypes: 'email' }),
      input({ activityType: 'meeting' }),
    )
    expect(result.exclusion).toBe('not_logged')
  })

  it('keeps an activity type the org does log', () => {
    const result = evaluateCaptureExclusions(
      settings({ logActivityTypes: 'meetings' }),
      input({ activityType: 'meeting' }),
    )
    expect(result.excluded).toBe(false)
  })

  it('excludes a subject matching a keyword, case-insensitively', () => {
    const result = evaluateCaptureExclusions(
      settings({ subjectExcludes: ['newsletter'] }),
      input({ subject: 'Your Weekly NEWSLETTER' }),
    )
    expect(result.exclusion).toBe('subject_keyword')
  })

  it('treats a quoted subject phrase as an exact match', () => {
    const exact = evaluateCaptureExclusions(
      settings({ subjectExcludes: ['"quarterly report"'] }),
      input({ subject: 'quarterly report' }),
    )
    expect(exact.exclusion).toBe('subject_keyword')

    const notExact = evaluateCaptureExclusions(
      settings({ subjectExcludes: ['"quarterly report"'] }),
      input({ subject: 'the quarterly report is ready' }),
    )
    expect(notExact.excluded).toBe(false)
  })

  it('excludes a role address by default', () => {
    const result = evaluateCaptureExclusions(settings(), input({ participants: [{ address: 'no-reply@acme.com' }] }))
    expect(result.exclusion).toBe('role_address')
  })

  it('keeps a role address when the auto-exclude toggle is off', () => {
    const result = evaluateCaptureExclusions(
      settings({ excludeRoleAddresses: false }),
      input({ participants: [{ address: 'no-reply@acme.com' }] }),
    )
    expect(result.excluded).toBe(false)
    expect(result.eligibleParticipants).toEqual([{ address: 'no-reply@acme.com' }])
  })

  it('excludes a specific address', () => {
    const result = evaluateCaptureExclusions(
      settings({ excludeAddresses: ['jane@ourco.com'] }),
      input({ participants: [{ address: 'jane@ourco.com' }] }),
    )
    expect(result.exclusion).toBe('address_excluded')
  })

  it('drops a denied domain but keeps the rest', () => {
    const result = evaluateCaptureExclusions(
      settings({ excludeDomains: ['spam.com'] }),
      input({ participants: [{ address: 'jane@acme.com' }, { address: 'noise@spam.com' }] }),
    )
    expect(result.excluded).toBe(false)
    expect(result.eligibleParticipants).toEqual([{ address: 'jane@acme.com' }])
  })

  it('restricts capture to allow-listed domains', () => {
    const result = evaluateCaptureExclusions(
      settings({ allowDomains: ['acme.com'] }),
      input({ participants: [{ address: 'jane@acme.com' }, { address: 'bob@other.com' }] }),
    )
    expect(result.excluded).toBe(false)
    expect(result.eligibleParticipants).toEqual([{ address: 'jane@acme.com' }])
  })

  it('excludes a message whose only participant is outside the allow-list', () => {
    const result = evaluateCaptureExclusions(
      settings({ allowDomains: ['acme.com'] }),
      input({ participants: [{ address: 'bob@other.com' }] }),
    )
    expect(result.exclusion).toBe('domain_not_allowed')
  })

  it('excludes an internal-only message', () => {
    const result = evaluateCaptureExclusions(
      settings({ internalDomains: ['ourco.com'] }),
      input({ participants: [{ address: 'a@ourco.com' }, { address: 'b@ourco.com' }] }),
    )
    expect(result.exclusion).toBe('internal_only')
  })

  it('keeps a message with an external participant even when internal domains are set', () => {
    const result = evaluateCaptureExclusions(
      settings({ internalDomains: ['ourco.com'] }),
      input({ participants: [{ address: 'a@ourco.com' }, { address: 'jane@acme.com' }] }),
    )
    expect(result.excluded).toBe(false)
  })

  it('excludes inbound mail over the bulk threshold', () => {
    const participants = Array.from({ length: 16 }, (_, i) => ({ address: `p${i}@acme.com` }))
    const result = evaluateCaptureExclusions(settings(), input({ participants, direction: 'inbound' }))
    expect(result.exclusion).toBe('bulk_inbound')
  })

  it('keeps inbound mail at or under the bulk threshold', () => {
    const participants = Array.from({ length: 15 }, (_, i) => ({ address: `p${i}@acme.com` }))
    const result = evaluateCaptureExclusions(settings(), input({ participants, direction: 'inbound' }))
    expect(result.excluded).toBe(false)
  })

  it('ignores the bulk threshold when the toggle is off', () => {
    const participants = Array.from({ length: 16 }, (_, i) => ({ address: `p${i}@acme.com` }))
    const result = evaluateCaptureExclusions(
      settings({ dropBulkInbound: false }),
      input({ participants, direction: 'inbound' }),
    )
    expect(result.excluded).toBe(false)
  })

  it('does not apply the bulk threshold to outbound mail', () => {
    const participants = Array.from({ length: 16 }, (_, i) => ({ address: `p${i}@acme.com` }))
    const result = evaluateCaptureExclusions(settings(), input({ participants, direction: 'outbound' }))
    expect(result.excluded).toBe(false)
  })
})
