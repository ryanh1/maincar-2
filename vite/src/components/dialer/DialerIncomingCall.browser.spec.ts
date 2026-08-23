import { expect, test } from '@playwright/test'

test('lets a rep answer an incoming call and use the in-call controls without Twilio', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto('/__fixtures/dialer-incoming-call')

  await expect(page.getByText('+12025550123')).toBeVisible()
  await page.getByRole('button', { name: 'Accept call' }).click()
  await expect(page.getByRole('group', { name: 'Call controls' })).toBeVisible()

  await page.getByRole('button', { name: 'Mute the call' }).click()
  await expect(page.getByRole('button', { name: 'Unmute the call' })).toBeVisible()
  expect(consoleErrors).toEqual([])
})
