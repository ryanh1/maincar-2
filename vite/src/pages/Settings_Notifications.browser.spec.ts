import { expect, test } from '@playwright/test'

const notificationPreferences = [
  { eventKind: 'mention', channel: 'in_app', enabled: true }, { eventKind: 'mention', channel: 'email', enabled: true }, { eventKind: 'mention', channel: 'push', enabled: true }, { eventKind: 'mention', channel: 'slack', enabled: true },
  { eventKind: 'assignment', channel: 'in_app', enabled: true }, { eventKind: 'assignment', channel: 'email', enabled: true }, { eventKind: 'assignment', channel: 'push', enabled: true }, { eventKind: 'assignment', channel: 'slack', enabled: true },
  { eventKind: 'comment', channel: 'in_app', enabled: true }, { eventKind: 'comment', channel: 'email', enabled: false }, { eventKind: 'comment', channel: 'push', enabled: false }, { eventKind: 'comment', channel: 'slack', enabled: false },
  { eventKind: 'status_change', channel: 'in_app', enabled: true }, { eventKind: 'status_change', channel: 'email', enabled: false }, { eventKind: 'status_change', channel: 'push', enabled: false }, { eventKind: 'status_change', channel: 'slack', enabled: false },
  { eventKind: 'team_broadcast', channel: 'in_app', enabled: true }, { eventKind: 'team_broadcast', channel: 'email', enabled: false }, { eventKind: 'team_broadcast', channel: 'push', enabled: false }, { eventKind: 'team_broadcast', channel: 'slack', enabled: false },
]

const deliverySettings = {
  channels: {
    in_app: { timing: 'immediate', digestFrequency: 'hourly', digestTime: '09:00' },
    email: { timing: 'digest', digestFrequency: 'daily', digestTime: '17:00' },
    push: { timing: 'immediate', digestFrequency: 'hourly', digestTime: '09:00' },
    slack: { timing: 'off', digestFrequency: 'hourly', digestTime: '09:00' },
  },
  quietHours: { enabled: true, startTime: '18:00', endTime: '08:00' },
}

test('saves quiet hours in Chromium without console errors', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await page.route('**/api/notification-preferences', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { notificationPreferences } })
    return route.fulfill({ json: route.request().postDataJSON() })
  })
  await page.route('**/api/notification-delivery-settings', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { notificationDeliverySettings: deliverySettings } })
    const body = route.request().postDataJSON() as { notificationDeliverySettings: typeof deliverySettings }
    Object.assign(deliverySettings, body.notificationDeliverySettings)
    return route.fulfill({ json: body })
  })

  await page.goto('/__fixtures/notification-settings')
  await expect(page.getByRole('combobox', { name: 'Email timing' })).toHaveText('Digest')
  await expect(page.getByLabel('Daily digest time (EDT)')).toHaveValue('17:00')
  await page.getByRole('switch', { name: 'Quiet hours' }).click()
  await expect(page.getByRole('switch', { name: 'Quiet hours' })).not.toBeChecked()
  await expect(page.getByText('Notification timing saved.')).toBeVisible()
  expect(consoleErrors).toEqual([])
})
