import { expect, test } from '@playwright/test'

test('shows and announces the recording indicator in Chromium', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto('/__fixtures/in-call-controls')
  await expect(page.getByRole('heading', { name: 'In-call controls fixture' })).toBeVisible()

  const indicator = page.getByRole('img', { name: 'Recording' })
  await expect(indicator).toBeVisible()
  await indicator.focus()
  await expect(page.getByRole('tooltip')).toHaveText('Recording')

  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(page.getByRole('img', { name: 'Recording' })).toHaveCount(0)
  await expect(page.getByRole('status')).toHaveText('Recording stopped.')

  await page.getByRole('button', { name: 'Start recording' }).click()
  await expect(page.getByRole('img', { name: 'Recording' })).toBeVisible()
  await expect(page.getByRole('status')).toHaveText('Recording started.')
  expect(consoleErrors).toEqual([])
})
