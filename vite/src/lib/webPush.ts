import { jsonFetch } from '@/lib/api'

function base64UrlToArrayBuffer(value: string): ArrayBuffer {
  const padded = value.padEnd(value.length + (4 - value.length % 4) % 4, '=')
  const binary = atob(padded.replaceAll('-', '+').replaceAll('_', '/'))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

export async function registerCallPushServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return navigator.serviceWorker.register('/maincar-push-sw.js', { scope: '/' })
}

export async function enableCallWebPush(): Promise<void> {
  const registration = await registerCallPushServiceWorker()
  if (!registration || !('PushManager' in window)) throw new Error('This browser does not support background browser alerts.')
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
  if (permission !== 'granted') throw new Error('Browser notifications are blocked. Change the browser permission to enable them.')

  const { webPushVapidPublicKey } = await jsonFetch<{ webPushVapidPublicKey: string }>('/api/web-push/vapid-key')
  const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToArrayBuffer(webPushVapidPublicKey),
  })
  await jsonFetch('/api/web-push/subscriptions', { method: 'PUT', body: JSON.stringify({ subscription: subscription.toJSON() }) })
}

export async function revokeCallWebPush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration('/maincar-push-sw.js')
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return
  await jsonFetch('/api/web-push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) })
  await subscription.unsubscribe()
}
