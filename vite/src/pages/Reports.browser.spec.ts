import { expect, test } from '@playwright/test'

const CONFIG = {
  baseObject: 'deal',
  rows: [{ field: 'stage' }],
  values: [{ field: 'amountMinor', aggregation: 'sum' }],
}

const REPORT = {
  id: 'report-1',
  name: 'Pipeline by stage',
  kind: 'pivot',
  config: CONFIG,
  createdAt: '2026-08-22T12:00:00.000Z',
  updatedAt: '2026-08-22T12:00:00.000Z',
}

test('opens, saves, renames, and moves a report to Trash in Chromium', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.route('**/api/orgs/org-fixture/reports**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/reports')) {
      return route.fulfill({ json: { reports: [REPORT], total: 1, page: 1, limit: 50 } })
    }
    if (request.method() === 'GET') return route.fulfill({ json: { report: REPORT } })
    if (request.method() === 'POST' && url.pathname.endsWith('/run')) {
      return route.fulfill({ json: { report: { rows: [{ stageId: 'stage-a', stageName: 'Discovery', amountMinor: '3500' }] } } })
    }
    if (request.method() === 'POST') return route.fulfill({ status: 201, json: { report: REPORT } })
    return route.fulfill({ json: { report: { id: REPORT.id, name: 'Pipeline Q3' } } })
  })

  await page.goto('/__fixtures/reports')
  await expect(page.getByRole('heading', { name: /^Reports/ })).toBeVisible()
  await page.getByRole('button', { name: 'Open Pipeline by stage' }).click()
  await expect(page.getByText('Discovery')).toBeVisible()
  await expect(page.getByText('$35.00')).toBeVisible()

  await page.getByRole('button', { name: 'Back to reports' }).click()
  await page.getByRole('button', { name: 'New report' }).click()
  await page.getByRole('button', { name: 'Save report' }).click()
  await page.getByLabel(/^Name/).fill('Quarterly pipeline')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: 'Pipeline by stage' })).toBeVisible()

  await page.getByRole('button', { name: 'Rename report' }).click()
  await page.getByLabel(/^Name/).fill('Pipeline Q3')
  await page.getByRole('button', { name: 'Rename' }).click()
  await page.getByRole('button', { name: 'Delete report' }).click()
  await expect(page.getByText('This report stays in Trash for 30 days.')).toBeVisible()
  await page.getByRole('button', { name: 'Delete' }).click()

  expect(consoleErrors).toEqual([])
})
