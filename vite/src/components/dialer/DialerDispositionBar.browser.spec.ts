import { expect, test } from '@playwright/test'

test('saves one visible numeric disposition and exposes More in Chromium', async ({ page }) => {
  const consoleErrors: string[] = []
  let saves = 0
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.route('**/api/orgs/org-fixture/dispositions', (route) =>
    route.fulfill({ json: { dispositions: [
      { id: 'connected', value: 'connected', label: 'Connected', color: 'option-1', icon: null, category: 'connected', isStandard: true, isPinned: true, pinOrder: 0, sortOrder: 0, isArchived: false, createdAt: '', updatedAt: '' },
      { id: 'callback', value: 'callback', label: 'Call back', color: 'option-7', icon: null, category: 'connected', isStandard: false, isPinned: false, pinOrder: null, sortOrder: 7, isArchived: false, createdAt: '', updatedAt: '' },
    ] } }),
  )
  await page.route('**/api/orgs/org-fixture/calls/call-fixture/disposition', async (route) => {
    saves += 1
    expect(route.request().postDataJSON()).toEqual({ dispositionId: 'connected' })
    await route.fulfill({ json: { call: {} } })
  })

  await page.goto('/__fixtures/dialer-disposition-bar')
  await expect(page.getByRole('heading', { name: 'Call outcome fixture' })).toBeVisible()
  await expect(page.getByRole('button', { name: '1: Connected' })).toBeVisible()
  await page.getByRole('button', { name: 'More call outcomes' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Call back' })).toBeVisible()

  await page.keyboard.press('Escape')
  await page.keyboard.press('1')
  await expect.poll(() => saves).toBe(1)
  expect(consoleErrors).toEqual([])
})
