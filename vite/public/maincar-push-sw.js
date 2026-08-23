self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {}
  event.waitUntil(self.registration.showNotification(payload.title || 'Maincar alert', {
    body: payload.body || 'Open Maincar to view the call.',
    tag: payload.tag,
    data: { url: payload.url || '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(clients.openWindow(event.notification.data.url))
})
