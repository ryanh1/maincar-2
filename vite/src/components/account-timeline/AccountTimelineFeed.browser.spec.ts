import { expect, test } from '@playwright/test'

const EVENT = {
  id: 'event-fixture', sourceType: 'call', sourceId: 'call-fixture', title: 'Called Ada Lovelace',
  preview: 'Discussed the renewal plan.', subtype: null, intensity: 3,
  display: { actorName: 'Grace Hopper', personName: 'Ada Lovelace', dealName: 'Enterprise renewal' },
  marker: null, direction: 'outbound', occurredAt: '2026-08-22T18:00:00.000Z',
  companyId: 'company-fixture', personId: 'person-fixture', dealId: 'deal-fixture',
}

test('changes the one shared timeline query when an activity filter changes', async ({ page }) => {
  const timelineRequests: string[] = []
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.route('**/api/orgs/org-fixture/account-timeline**', async (route) => {
    timelineRequests.push(route.request().url())
    if (route.request().url().includes('/event-fixture?')) {
      await route.fulfill({ json: {
        event: EVENT,
        detail: { type: 'call', id: 'call-fixture', transcript: 'Discussed the renewal plan.', openFullCallPath: '/calls/call-fixture' },
        navigation: { previousEventId: null, nextEventId: null },
      } })
      return
    }
    await route.fulfill({ json: { events: [EVENT], nextCursor: null, range: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', isDefault: true } } })
  })

  await page.goto('/__fixtures/account-timeline')
  await expect(page.getByText('Called Ada Lovelace')).toBeVisible()
  expect(timelineRequests).toHaveLength(1)

  await page.getByRole('combobox', { name: 'Activity type' }).click()
  await page.getByRole('option', { name: 'Calls' }).click()
  await expect.poll(() => timelineRequests).toHaveLength(2)
  expect(timelineRequests[1]).toContain('sourceType=call')
  expect(consoleErrors).toEqual([])
})

test('opens the selected event in the right-side detail panel without leaving the filtered timeline', async ({ page }) => {
  await page.route('**/api/orgs/org-fixture/account-timeline**', async (route) => {
    if (route.request().url().includes('/event-fixture?')) {
      await route.fulfill({ json: {
        event: EVENT,
        detail: { type: 'call', id: 'call-fixture', transcript: 'Discussed the renewal plan.', openFullCallPath: '/calls/call-fixture' },
        navigation: { previousEventId: null, nextEventId: null },
      } })
      return
    }
    await route.fulfill({ json: { events: [EVENT], nextCursor: null, range: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', isDefault: true } } })
  })

  await page.goto('/__fixtures/account-timeline')
  await page.getByRole('button', { name: 'Called Ada Lovelace' }).click()
  const panel = page.getByRole('dialog', { name: 'call' })
  await expect(panel.getByText('Discussed the renewal plan.')).toBeVisible()
  await expect(panel.getByRole('link', { name: 'Open full call' })).toHaveAttribute('href', '/calls/call-fixture')
})
