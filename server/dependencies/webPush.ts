import webpush from 'web-push'

import { WEB_PUSH_VAPID_PRIVATE_KEY, WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_SUBJECT } from '../src/config.js'

export async function sendWebPush(input: { endpoint: string; p256dh: string; auth: string; payload: unknown }): Promise<void> {
  if (!WEB_PUSH_VAPID_SUBJECT || !WEB_PUSH_VAPID_PUBLIC_KEY || !WEB_PUSH_VAPID_PRIVATE_KEY) {
    throw new Error('Web Push VAPID keys are not configured.')
  }
  webpush.setVapidDetails(WEB_PUSH_VAPID_SUBJECT, WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY)
  await webpush.sendNotification(
    { endpoint: input.endpoint, keys: { p256dh: input.p256dh, auth: input.auth } },
    JSON.stringify(input.payload),
    { TTL: 60, urgency: 'high' },
  )
}
