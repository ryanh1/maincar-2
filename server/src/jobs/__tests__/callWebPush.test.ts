import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, sendWebPushMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn() },
    webPushDelivery: { createMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    webPushSubscription: { deleteMany: vi.fn() },
  },
  sendWebPushMock: vi.fn(),
}))

vi.mock('../../db.js', () => ({ default: prismaMock }))
vi.mock('../../../dependencies/webPush.js', () => ({ sendWebPush: sendWebPushMock }))
vi.mock('../queue.js', () => ({ JOB_DELIVER_CALL_WEB_PUSH: 'deliver-call-web-push', sendJob: vi.fn(), workJob: vi.fn() }))

import { deliverCallWebPush } from '../callWebPush.js'

const subscription = { id: 'sub-1', endpoint: 'https://push.example.test/sub-1', p256dh: 'p256dh', auth: 'auth' }
const enabledSettings = {
  incoming: { sound: true, popover: true, browserNotification: true, desktopNotification: false },
  missed: { sound: false, popover: true, browserNotification: false, desktopNotification: false },
  voicemail: { sound: false, popover: true, browserNotification: false, desktopNotification: false },
  ringSound: 'classic', volume: 0.8, doNotDisturb: { enabled: false, startTime: '18:00', endTime: '08:00' },
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.user.findUnique.mockResolvedValue({ timeZone: 'America/New_York', callAlertSettings: enabledSettings, webPushSubscriptions: [subscription] })
  prismaMock.webPushDelivery.createMany.mockResolvedValue({ count: 1 })
})

describe('call web-push job', () => {
  it('sends one privacy-safe payload and records the idempotent delivery', async () => {
    await deliverCallWebPush({ userId: 'user-1', event: 'incoming', eventKey: 'call:call-1:incoming' })

    expect(sendWebPushMock).toHaveBeenCalledWith(expect.objectContaining({ endpoint: subscription.endpoint, payload: expect.objectContaining({ body: 'Open Maincar to view the call.' }) }))
    expect(prismaMock.webPushDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { subscriptionId: 'sub-1', eventKey: 'call:call-1:incoming' } }))
  })

  it('does not send a duplicate delivery claim or a disabled event channel', async () => {
    prismaMock.webPushDelivery.createMany.mockResolvedValue({ count: 0 })
    await deliverCallWebPush({ userId: 'user-1', event: 'incoming', eventKey: 'call:call-1:incoming' })
    expect(sendWebPushMock).not.toHaveBeenCalled()

    prismaMock.user.findUnique.mockResolvedValue({ timeZone: 'America/New_York', callAlertSettings: enabledSettings, webPushSubscriptions: [subscription] })
    await deliverCallWebPush({ userId: 'user-1', event: 'missed', eventKey: 'call:call-1:missed' })
    expect(sendWebPushMock).not.toHaveBeenCalled()
  })

  it('releases a failed delivery claim so the queued job can retry', async () => {
    const failure = new Error('push service unavailable')
    sendWebPushMock.mockRejectedValue(failure)

    await expect(deliverCallWebPush({ userId: 'user-1', event: 'incoming', eventKey: 'call:call-1:incoming' })).rejects.toThrow(failure)

    expect(prismaMock.webPushDelivery.deleteMany).toHaveBeenCalledWith({
      where: { subscriptionId: 'sub-1', eventKey: 'call:call-1:incoming' },
    })
  })

  it('removes a subscription the push service reports as expired', async () => {
    sendWebPushMock.mockRejectedValue({ statusCode: 410 })

    await expect(deliverCallWebPush({ userId: 'user-1', event: 'incoming', eventKey: 'call:call-1:incoming' })).rejects.toMatchObject({ statusCode: 410 })

    expect(prismaMock.webPushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: 'sub-1' } })
  })
})
