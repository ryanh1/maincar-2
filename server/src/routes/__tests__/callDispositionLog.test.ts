import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

const { prismaMock, verifyTokenMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() }, membership: { findFirst: vi.fn() }, org: { findFirst: vi.fn() },
    dispositionDef: { findFirst: vi.fn() }, call: { updateMany: vi.fn(), findFirst: vi.fn() },
  }, verifyTokenMock: vi.fn(),
}))
vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/firebaseAdmin.js', () => ({ verifyFirebaseIdToken: verifyTokenMock, setFirebaseUserDisabled: vi.fn(), deleteFirebaseUser: vi.fn() }))

import app from '../../app.js'

const ORG_ID = 'org-a'
const URL = `/api/orgs/${ORG_ID}/calls/call-1/disposition`
const NOTE_URL = `/api/orgs/${ORG_ID}/calls/call-1/note`
const AUTH = 'Bearer token'
const NOW = new Date('2026-08-22T12:00:00.000Z')

function callRow() {
  return {
    id: 'call-1', orgId: ORG_ID, userId: 'user-a', fromE164: '+12025550123', toE164: '+13035550199', direction: 'outbound', status: 'completed',
    twilioCallSid: null, recordingConsent: null, recordingPlanned: false, recordingReason: 'recording-disabled', destinationState: null, recordingEnabled: false,
    recordingUrl: null, recordingStatus: 'skipped-not-recorded', transcriptStatus: 'skipped-not-recorded', transcript: null, durationS: 12, startedAt: NOW, endedAt: NOW,
    dispositionId: 'disposition-1', noteText: 'Asked for a demo.', personId: null, companyId: null, dealId: null, customJson: {}, isArchived: false, deletedAt: null,
    createdAt: NOW, updatedAt: NOW, disposition: { id: 'disposition-1', value: 'connected', label: 'Connected', color: 'option-1', icon: null, category: 'connected' },
    person: null, company: null, deal: null, finalTranscript: null, speakers: [],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ uid: 'uid-a', email: 'a@example.com' })
  prismaMock.user.findUnique.mockResolvedValue({ id: 'user-a', firebaseUid: 'uid-a', email: 'a@example.com', enabled: true })
  prismaMock.membership.findFirst.mockResolvedValue({ id: 'membership-a', userId: 'user-a', orgId: ORG_ID, roles: ['basic'], isActive: true, createdAt: NOW, updatedAt: NOW, org: { id: ORG_ID, enabled: true } })
  prismaMock.dispositionDef.findFirst.mockResolvedValue({ id: 'disposition-1' })
  prismaMock.call.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.call.findFirst.mockResolvedValue(callRow())
})

describe('logging a call disposition', () => {
  it('writes the selected organization disposition and optional note onto the call', async () => {
    const response = await request(app).patch(URL).set('Authorization', AUTH).send({ dispositionId: 'disposition-1', noteText: 'Asked for a demo.' })

    expect(response.status).toBe(200)
    expect(response.body.call).toEqual(expect.objectContaining({ noteText: 'Asked for a demo.', disposition: expect.objectContaining({ category: 'connected' }) }))
    expect(prismaMock.call.updateMany).toHaveBeenCalledWith({ where: { id: 'call-1', orgId: ORG_ID }, data: { dispositionId: 'disposition-1', noteText: 'Asked for a demo.' } })
  })

  it('keeps an autosaved note when logging a disposition without replacing it', async () => {
    const response = await request(app).patch(URL).set('Authorization', AUTH).send({ dispositionId: 'disposition-1' })

    expect(response.status).toBe(200)
    expect(prismaMock.call.updateMany).toHaveBeenCalledWith({
      where: { id: 'call-1', orgId: ORG_ID },
      data: { dispositionId: 'disposition-1' },
    })
  })

  it('refuses a disposition outside the active organization before changing the call', async () => {
    prismaMock.dispositionDef.findFirst.mockResolvedValue(null)

    const response = await request(app).patch(URL).set('Authorization', AUTH).send({ dispositionId: 'other-org-disposition' })

    expect(response.status).toBe(400)
    expect(prismaMock.call.updateMany).not.toHaveBeenCalled()
  })
})

describe('saving an in-call note', () => {
  it('writes a trimmed note through an organization-scoped update', async () => {
    const response = await request(app).patch(NOTE_URL).set('Authorization', AUTH).send({ noteText: ' Asked for a demo. ' })

    expect(response.status).toBe(200)
    expect(prismaMock.call.updateMany).toHaveBeenCalledWith({
      where: { id: 'call-1', orgId: ORG_ID },
      data: { noteText: 'Asked for a demo.' },
    })
    expect(response.body.call).toEqual(expect.objectContaining({ noteText: 'Asked for a demo.' }))
  })
})
