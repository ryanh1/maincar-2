import { describe, expect, it } from 'vitest'

import {
  REQUIRED_SCOPES,
  allRequestedScopes,
  evaluateGrant,
  missingScopeParams,
  providerLabel,
} from '../oauthScopes.js'

// The four Google scopes, by capability, so a test can build a grant that is
// missing exactly one without hard-coding URLs into the assertion.
const G = {
  read: 'https://www.googleapis.com/auth/gmail.readonly',
  send: 'https://www.googleapis.com/auth/gmail.send',
  calendar: 'https://www.googleapis.com/auth/calendar.events',
  identity: 'https://www.googleapis.com/auth/userinfo.email',
}

describe('REQUIRED_SCOPES', () => {
  it('lists read, send, and calendar (plus identity) per provider, each fully shaped', () => {
    for (const provider of ['google', 'microsoft'] as const) {
      const caps = REQUIRED_SCOPES[provider].map((s) => s.capability)
      expect(caps).toContain('read')
      expect(caps).toContain('send')
      expect(caps).toContain('calendar')
      for (const scope of REQUIRED_SCOPES[provider]) {
        expect(scope.param.length).toBeGreaterThan(0)
        expect(scope.label.length).toBeGreaterThan(0)
        expect(scope.consequence.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('evaluateGrant', () => {
  it('full grant → connected, no error, empty detail', () => {
    const result = evaluateGrant('google', [G.read, G.send, G.calendar, G.identity])
    expect(result).toEqual({ status: 'connected', errorCode: null, statusDetail: '' })
  })

  it('extra scopes beyond what was required still count as a full grant', () => {
    const result = evaluateGrant('google', [
      G.read,
      G.send,
      G.calendar,
      G.identity,
      'https://www.googleapis.com/auth/some.unrequested.scope',
    ])
    expect(result.status).toBe('connected')
  })

  it('two of three (send refused) → limited / partial_access naming the third consequence', () => {
    // read + calendar granted, identity granted, send refused.
    const result = evaluateGrant('google', [G.read, G.calendar, G.identity])
    expect(result.status).toBe('limited')
    expect(result.errorCode).toBe('partial_access')
    expect(result.statusDetail).toBe('Maincar cannot send email as you.')
    // The other two capabilities are NOT named — only what actually broke.
    expect(result.statusDetail).not.toContain('read your email')
    expect(result.statusDetail).not.toContain('calendar')
  })

  it('zero granted → limited with every consequence named', () => {
    const result = evaluateGrant('google', [])
    expect(result.status).toBe('limited')
    expect(result.errorCode).toBe('partial_access')
    for (const scope of REQUIRED_SCOPES.google) {
      expect(result.statusDetail).toContain(scope.consequence)
    }
  })

  it('never names a raw scope string in statusDetail — for any provider, any grant', () => {
    for (const provider of ['google', 'microsoft'] as const) {
      // Both a partial grant and a zero grant produce a statusDetail.
      for (const granted of [[], [REQUIRED_SCOPES[provider][0].param]]) {
        const { statusDetail } = evaluateGrant(provider, granted)
        expect(statusDetail).not.toMatch(/https?:\/\//)
        expect(statusDetail).not.toContain('googleapis.com')
        // No scope param string leaks into the human copy.
        for (const scope of REQUIRED_SCOPES[provider]) {
          expect(statusDetail).not.toContain(scope.param)
        }
      }
    }
  })
})

describe('missingScopeParams', () => {
  it('returns exactly the missing param, and only that one', () => {
    const missing = missingScopeParams('google', [G.read, G.calendar, G.identity])
    expect(missing).toEqual([G.send])
  })

  it('returns [] when the grant is complete', () => {
    expect(missingScopeParams('google', [G.read, G.send, G.calendar, G.identity])).toEqual([])
  })

  it('returns every required param when nothing was granted', () => {
    expect(missingScopeParams('microsoft', [])).toEqual(
      REQUIRED_SCOPES.microsoft.map((s) => s.param),
    )
  })
})

describe('allRequestedScopes', () => {
  it('includes every evaluable scope param', () => {
    const scopes = allRequestedScopes('google')
    for (const scope of REQUIRED_SCOPES.google) {
      expect(scopes).toContain(scope.param)
    }
  })

  it('adds offline_access for Microsoft so the grant can outlive its first hour', () => {
    expect(allRequestedScopes('microsoft')).toContain('offline_access')
  })
})

describe('providerLabel', () => {
  it('gives the human name of each provider', () => {
    expect(providerLabel('google')).toBe('Google')
    expect(providerLabel('microsoft')).toBe('Microsoft')
  })
})
