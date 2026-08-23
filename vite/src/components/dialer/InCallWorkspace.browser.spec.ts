import { expect, test } from '@playwright/test'

test('walks the live workspace for known and unknown callers', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.route('**/api/orgs/org-fixture/calls/**', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') {
      const known = request.url().endsWith('/call-known')
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          call: {
            id: known ? 'call-known' : 'call-unknown',
            toE164: known ? '+12025550123' : '+12025550999',
            noteText: null,
            review: {
              crm: {
                person: known ? { id: 'person-fixture', firstName: 'Jordan', lastName: 'Lee', preferredFirstName: null } : null,
                company: known ? { id: 'company-fixture', name: 'Acme' } : null,
                deal: null,
              },
            },
          },
        }),
      })
      return
    }
    if (request.method() === 'DELETE') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ call: { durationS: 75 } }) })
      return
    }
    if (request.method() === 'PATCH') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ call: { noteText: 'Asked for a demo.' } }) })
      return
    }
    await route.continue()
  })
  await page.route('**/api/orgs/org-fixture/activity?**', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        activity: [
          {
            id: 'activity-prior-call', sourceType: 'call', sourceId: 'call-prior',
            summary: 'Completed call with Acme', preview: 'Asked for a proposal.', direction: 'outbound',
            occurredAt: '2026-08-22T18:00:00.000Z', createdByUserId: 'user-fixture',
            companyId: 'company-fixture', personId: 'person-fixture', dealId: null,
            createdAt: '2026-08-22T18:00:00.000Z',
          },
        ],
        page: 1, limit: 3, hasMore: false,
      }),
    })
  })

  await page.goto('/__fixtures/in-call-workspace')
  await expect(page.getByRole('heading', { name: 'In-call workspace fixture' })).toBeVisible()
  await expect(page.getByText('+12025550123')).toBeVisible()
  await expect(page.getByText('Jordan Lee')).toBeVisible()
  await expect(page.getByText('Acme', { exact: true })).toBeVisible()

  const priorCalls = page.getByRole('button', { name: 'Prior calls at Acme' })
  await expect(priorCalls).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByText('Completed call with Acme')).toHaveCount(0)
  await priorCalls.click()
  await expect(priorCalls).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('Completed call with Acme')).toBeVisible()
  await page.getByRole('button', { name: 'Show more' }).click()
  await expect(page.getByText('Asked for a proposal.')).toBeVisible()

  const notes = page.getByRole('textbox', { name: 'Call notes' })
  await expect(notes).not.toBeFocused()
  await page.getByRole('button', { name: 'Connect call' }).click()
  await expect(notes).toBeFocused()
  await notes.fill('Asked for a demo.')
  await expect(notes).toHaveValue('Asked for a demo.')

  await page.getByRole('button', { name: 'Open keypad' }).click()
  await expect(page.getByRole('heading', { name: 'In-call workspace fixture' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'End the call' })).toBeVisible()
  await page.getByRole('button', { name: 'Close keypad' }).click()
  await expect(page.getByRole('button', { name: 'Open keypad' })).toBeVisible()

  const hangupRequest = page.waitForRequest((request) => request.method() === 'DELETE' && request.url().includes('/calls/call-known'))
  await page.getByRole('button', { name: 'End the call' }).click()
  await hangupRequest

  await page.getByRole('button', { name: 'Show unknown caller' }).click()
  await expect(page.getByText('+12025550999')).toBeVisible()
  await expect(page.getByText('Jordan Lee')).toHaveCount(0)
  await expect(page.getByText('Acme')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Prior calls at/ })).toHaveCount(0)
  expect(consoleErrors).toEqual([])
})
