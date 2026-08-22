import { expect, test } from '@playwright/test'

test('plays the deterministic audio fixture with compact controls and keyboard navigation', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto('/__fixtures/audio-player')
  await expect(page.getByRole('heading', { name: 'Audio player fixture' })).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Seek recording' })).not.toHaveAttribute('aria-disabled', 'true')

  await page.getByRole('button', { name: 'Play recording' }).click()
  await expect(page.getByRole('button', { name: 'Pause recording' })).toBeVisible()

  const seek = page.getByRole('slider', { name: 'Seek recording' })
  await seek.focus()
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('m')
  await expect(page.getByRole('button', { name: 'Unmute recording' })).toBeVisible()

  await page.getByRole('combobox', { name: 'Playback speed' }).click()
  await page.getByRole('option', { name: '3.5×' }).click()
  await expect(page.getByRole('combobox', { name: 'Playback speed' })).toHaveText('3.5×')
  expect(consoleErrors).toEqual([])
})
