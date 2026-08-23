import { expect, test } from '@playwright/test'

test('uses a selected secondary number for one call, then returns the picker to primary', async ({ page }) => {
  const consoleErrors: string[] = []
  const callBodies: unknown[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.addInitScript(() => {
    sessionStorage.setItem('maincar.greenroom.check', JSON.stringify({
      permission: 'granted',
      hasMicrophone: true,
      problem: null,
      checkedAt: new Date().toISOString(),
    }))
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: {
        query: async () => ({
          state: 'granted',
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }),
      },
    })
  })

  await page.route('**/api/orgs/org-fixture/phone-numbers', (route) => route.fulfill({
    json: {
      numbers: [
        { id: 'number-primary', e164: '+14155550100', status: 'active', isActiveForOutbound: true },
        { id: 'number-secondary', e164: '+14155550101', status: 'active', isActiveForOutbound: false },
      ],
      total: 2,
      activeCount: 1,
      readyCount: 2,
    },
  }))
  await page.route('**/api/orgs/org-fixture/calls', async (route) => {
    callBodies.push(route.request().postDataJSON())
    await route.fulfill({
      status: 201,
      json: {
        call: {
          id: 'call-fixture',
          direction: 'outbound',
          status: 'queued',
          fromE164: '+14155550101',
          toE164: '+12025550123',
          recordingPlanned: false,
          recordingReason: 'recording-disabled',
          twilioCallSid: null,
          createdAt: '2026-08-23T00:00:00.000Z',
        },
      },
    })
  })

  await page.goto('/__fixtures/numeric-keypad')
  await expect(page.getByRole('heading', { name: 'Dialer number picker fixture' })).toBeVisible()

  const picker = page.getByRole('combobox', { name: 'Call from' })
  await expect(picker).toHaveText('+14155550100 (Primary)')
  await picker.click()
  await page.getByRole('option', { name: '+14155550101' }).click()
  await expect(picker).toHaveText('+14155550101')

  await page.getByRole('textbox', { name: 'Phone number' }).fill('2025550123')
  await page.getByRole('button', { name: 'Call' }).click()

  await expect.poll(() => callBodies).toEqual([
    { toE164: '+12025550123', phoneNumberId: 'number-secondary' },
  ])
  await expect(picker).toHaveText('+14155550100 (Primary)')
  expect(consoleErrors).toEqual([])
})
