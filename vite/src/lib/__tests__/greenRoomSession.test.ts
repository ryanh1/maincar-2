import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  GREEN_ROOM_SESSION_KEY,
  clearGreenRoomCheck,
  greenRoomCheckPassed,
  readGreenRoomCheck,
  recordGreenRoomCheck,
} from '../greenRoomSession'

beforeEach(() => {
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe('recordGreenRoomCheck', () => {
  it('records a pass under the namespaced session key', () => {
    const stored = recordGreenRoomCheck({ permission: 'granted', hasMicrophone: true })

    expect(stored).toMatchObject({ permission: 'granted', hasMicrophone: true, problem: null })
    expect(stored?.checkedAt).toEqual(expect.any(String))
    expect(readGreenRoomCheck()).toEqual(stored)
    expect(window.sessionStorage.getItem(GREEN_ROOM_SESSION_KEY)).not.toBeNull()
  })

  it('records the problem, not just the pass, so a later decision can compare', () => {
    recordGreenRoomCheck({
      permission: 'denied',
      hasMicrophone: false,
      problem: 'Allow microphone access in your browser settings, then try again.',
    })

    const check = readGreenRoomCheck()
    expect(check?.permission).toBe('denied')
    expect(check?.hasMicrophone).toBe(false)
    expect(check?.problem).toMatch(/microphone access/i)
  })

  it('writes to sessionStorage, never localStorage', () => {
    recordGreenRoomCheck({ permission: 'granted', hasMicrophone: true })

    expect(window.localStorage.getItem(GREEN_ROOM_SESSION_KEY)).toBeNull()
  })

  it('returns null instead of throwing when the write fails (Safari private mode)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })

    expect(() => recordGreenRoomCheck({ permission: 'granted', hasMicrophone: true })).not.toThrow()
    expect(recordGreenRoomCheck({ permission: 'granted', hasMicrophone: true })).toBeNull()
  })
})

describe('readGreenRoomCheck', () => {
  it('returns null when nothing was recorded this session', () => {
    expect(readGreenRoomCheck()).toBeNull()
  })

  it('returns null for unparseable JSON', () => {
    window.sessionStorage.setItem(GREEN_ROOM_SESSION_KEY, 'not json')

    expect(readGreenRoomCheck()).toBeNull()
  })

  it('returns null for a shape an older build could have written', () => {
    window.sessionStorage.setItem(GREEN_ROOM_SESSION_KEY, JSON.stringify({ ok: true }))

    expect(readGreenRoomCheck()).toBeNull()
  })

  it('returns null for a stored literal null', () => {
    window.sessionStorage.setItem(GREEN_ROOM_SESSION_KEY, 'null')

    expect(readGreenRoomCheck()).toBeNull()
  })

  it('returns null for an unrecognised permission value', () => {
    window.sessionStorage.setItem(
      GREEN_ROOM_SESSION_KEY,
      JSON.stringify({ permission: 'maybe', hasMicrophone: true, problem: null, checkedAt: 'x' })
    )

    expect(readGreenRoomCheck()).toBeNull()
  })

  it('returns null instead of throwing when the read fails', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })

    expect(readGreenRoomCheck()).toBeNull()
  })
})

describe('clearGreenRoomCheck', () => {
  it('forgets the recorded check', () => {
    recordGreenRoomCheck({ permission: 'granted', hasMicrophone: true })
    clearGreenRoomCheck()

    expect(readGreenRoomCheck()).toBeNull()
  })

  it('does not throw when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })

    expect(() => clearGreenRoomCheck()).not.toThrow()
  })
})

describe('greenRoomCheckPassed', () => {
  const base = { problem: null, checkedAt: '2026-08-20T00:00:00.000Z' } as const

  it('passes when a microphone was found and nothing went wrong', () => {
    expect(greenRoomCheckPassed({ ...base, permission: 'granted', hasMicrophone: true })).toBe(true)
  })

  it('fails when no microphone was found', () => {
    expect(greenRoomCheckPassed({ ...base, permission: 'granted', hasMicrophone: false })).toBe(false)
  })

  it('fails when the check recorded a problem', () => {
    expect(
      greenRoomCheckPassed({
        ...base,
        permission: 'granted',
        hasMicrophone: true,
        problem: 'No microphone found. Plug one in, then try again.',
      })
    ).toBe(false)
  })

  it('fails when permission was denied', () => {
    expect(greenRoomCheckPassed({ ...base, permission: 'denied', hasMicrophone: true })).toBe(false)
  })
})
