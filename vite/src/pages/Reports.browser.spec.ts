import { expect, test } from '@playwright/test'

const CONFIG = {
  baseObject: 'deal',
  rows: [{ field: 'stage' }],
  columns: [],
  values: [{ field: 'amountMinor', aggregation: 'sum' }],
  timeZone: { mode: 'viewer' },
}

const REPORT = {
  id: 'report-1',
  name: 'Pipeline by stage',
  kind: 'pivot',
  config: CONFIG,
  createdAt: '2026-08-22T12:00:00.000Z',
  updatedAt: '2026-08-22T12:00:00.000Z',
}

const TEAM = {
  id: 'team-revenue',
  orgId: 'org-fixture',
  name: 'Revenue',
  leadUserId: 'user-fixture',
  isArchived: false,
  archivedAt: null,
  memberUserIds: ['user-fixture'],
  members: [{ userId: 'user-fixture', email: 'fixture@example.com', firstName: 'Fixture', lastName: 'Rep', title: null }],
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
      const config = request.postDataJSON().config
      if (config.values[0].aggregation === 'average') {
        return route.fulfill({
          json: {
            report: {
              rows: [{ ownerId: 'user-fixture', ownerName: 'Fixture Rep', stageId: 'stage-a', stageName: 'Discovery', value: '2300' }],
              rollups: [
                { ownerId: 'user-fixture', ownerName: 'Fixture Rep', groupedFields: ['owner'], value: '2300' },
                { stageId: 'stage-a', stageName: 'Discovery', groupedFields: ['stage'], value: '2300' },
                { groupedFields: [], value: '3700' },
              ],
            },
          },
        })
      }
      return route.fulfill({ json: { report: { rows: [{ ownerId: 'user-fixture', ownerName: 'Fixture Rep', stageId: 'stage-a', stageName: 'Discovery', amountMinor: '3500' }] } } })
    }
    if (request.method() === 'POST') return route.fulfill({ status: 201, json: { report: REPORT } })
    return route.fulfill({ json: { report: { id: REPORT.id, name: 'Pipeline Q3' } } })
  })
  await page.route('**/api/orgs/org-fixture/teams**', async (route) => {
    const url = new URL(route.request().url())
    return route.fulfill({ json: { teams: url.searchParams.get('isArchived') === 'true' ? [] : [TEAM] } })
  })

  await page.goto('/__fixtures/reports')
  await expect(page.getByRole('heading', { name: /^Reports/ })).toBeVisible()
  await page.getByRole('button', { name: 'Open Pipeline by stage' }).click()
  await expect(page.getByText('Discovery')).toBeVisible()
  await expect(page.getByText('$35.00').first()).toBeVisible()

  await page.getByRole('button', { name: 'Back to reports' }).click()
  await page.getByRole('button', { name: 'New report' }).click()
  await page.getByRole('checkbox', { name: 'Revenue' }).click()
  await expect(page.getByText('Owner is on Revenue.')).toBeVisible()
  await page.getByRole('button', { name: 'Owner', exact: true }).click()
  await page.getByRole('button', { name: 'Stage', exact: true }).click()
  await page.getByRole('button', { name: 'Amount', exact: true }).click()
  await expect(page.getByRole('rowheader', { name: 'Fixture Rep' })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: 'Grand total' })).toBeVisible()
  await page.getByRole('button', { name: 'Chart' }).click()
  await expect(page.getByLabel('Report chart')).toBeVisible()
  await page.getByRole('button', { name: 'Edit Y axis' }).click()
  await page.getByLabel('Y axis max').fill('100')
  await page.getByRole('button', { name: 'Apply' }).click()
  await page.getByRole('button', { name: 'Table' }).click()
  await expect(page.getByRole('rowheader', { name: 'Grand total' })).toBeVisible()
  await page.getByTestId('drop-zone-values').getByRole('button', { name: /Amount/ }).click()
  await page.getByRole('button', { name: 'Average amount', exact: true }).click()
  await expect(page.getByTestId('drop-zone-values')).toContainText('Average amount')
  await expect(page.getByText('$37.00')).toBeVisible()
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
