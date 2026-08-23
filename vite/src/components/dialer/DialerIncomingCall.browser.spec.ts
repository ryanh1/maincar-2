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

test('shows a known caller context before answer and an unknown caller’s raw number without a record link', async ({ page }) => {
  await page.goto('/__fixtures/dialer-incoming-call')

  await expect(page.getByRole('link', { name: 'Open Jordan Lee' })).toHaveAttribute('href', '/records/person/person-fixture')
  await expect(page.getByText('Acme')).toBeVisible()
  await expect(page.getByText('Champion')).toBeVisible()
  await expect(page.getByText(/Last touch .*EDT/)).toBeVisible()

  await page.getByRole('button', { name: 'Show unknown caller' }).click()
  await expect(page.getByText('+12025550999')).toBeVisible()
  await expect(page.getByRole('link', { name: /Open / })).toHaveCount(0)
  await expect(page.getByText('Acme')).toHaveCount(0)
})
