import { describe, expect, it } from 'vitest'

import { canEditSavedView, canShareSavedView, canViewSavedView } from './savedViewPolicy.js'

const privateView = { ownerUserId: 'owner', isShared: false }
const sharedView = { ownerUserId: 'owner', isShared: true }

describe('saved view policy', () => {
  it('keeps a personal view private while allowing every organization member to use a shared view', () => {
    expect(canViewSavedView(privateView, 'member')).toBe(false)
    expect(canViewSavedView(sharedView, 'member')).toBe(true)
    expect(canEditSavedView(sharedView, 'member')).toBe(true)
    expect(canShareSavedView(sharedView, 'member')).toBe(true)
  })
})
