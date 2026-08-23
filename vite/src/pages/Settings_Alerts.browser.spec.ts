import { expect, test } from '@playwright/test'

const settings = {
  incoming: { sound: true, popover: true, browserNotification: false, desktopNotification: false },
  missed: { sound: false, popover: true, browserNotification: false, desktopNotification: false },
  voicemail: { sound: false, popover: true, browserNotification: false, desktopNotification: false },
  ringSound: 'classic', volume: 0.8, doNotDisturb: { enabled: false, startTime: '18:00', endTime: '08:00' },
}

test('persists a foreground alert control in Chromium without console errors', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await page.route('**/api/call-alert-settings', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { callAlertSettings: settings } })
    const body = route.request().postDataJSON() as { callAlertSettings: typeof settings }
    Object.assign(settings, body.callAlertSettings)
    return route.fulfill({ json: body })
  })

  await page.goto('/__fixtures/call-alerts')
  await expect(page.getByRole('switch', { name: 'Incoming call sound' })).toBeChecked()
  await page.getByRole('switch', { name: 'Incoming call sound' }).click()
  await expect(page.getByRole('switch', { name: 'Incoming call sound' })).not.toBeChecked()
  await expect(page.getByText('Call alerts saved.')).toBeVisible()
  await expect(page.getByText('All schedule times use EDT.')).toBeVisible()
  expect(consoleErrors).toEqual([])
})
