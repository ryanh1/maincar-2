import { expect, test } from '@playwright/test'

test('creates, shares, and unshares a template in both themes on a narrow Settings viewport', async ({ page }) => {
  const consoleErrors: string[] = []
  const templateRequests: Array<{ method: string; body: Record<string, unknown> | null }> = []
  const templateListRequests: URL[] = []
  const draftRequests: string[] = []
  const templates: Array<Record<string, unknown>> = [
    {
      id: 'template-shared',
      name: 'Shared follow-up',
      subject: 'Thanks',
      bodyHtml: '<p>Thanks for your time.</p>',
      visibility: 'ORGANIZATION',
      createdById: 'user-fixture',
      fieldsJson: null,
      createdAt: '2026-08-22T12:00:00.000Z',
      updatedAt: '2026-08-22T12:00:00.000Z',
    },
  ]

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('request', (request) => {
    if (request.url().includes('/drafts')) draftRequests.push(request.url())
  })
  await page.route('**/api/orgs/org-fixture/members**', (route) =>
    route.fulfill({ json: { members: [], total: 0, page: 1, limit: 200, meta: { activeAdminCount: 1 }, viewerRoles: ['basic'] } }),
  )
  await page.route('**/api/email/orgs/org-fixture/templates**', async (route) => {
    const request = route.request()
    const templateId = new URL(request.url()).pathname.split('/').at(-1)
    if (request.method() === 'GET') {
      const url = new URL(request.url())
      templateListRequests.push(url)
      const scope = url.searchParams.get('scope') ?? 'private'
      const q = (url.searchParams.get('q') ?? '').toLowerCase()
      const visible = templates.filter((template) =>
        (scope === 'all' || template.visibility === 'PRIVATE') &&
        (!q || String(template.name).toLowerCase().includes(q) || String(template.subject).toLowerCase().includes(q)),
      )
      return route.fulfill({
        json: {
          templates: visible,
          total: visible.length,
          page: Number(url.searchParams.get('page') ?? '1'),
          limit: Number(url.searchParams.get('limit') ?? '25'),
        },
      })
    }

    const body = request.postDataJSON() as Record<string, unknown> | null
    templateRequests.push({ method: request.method(), body })
    if (request.method() === 'POST') {
      const template = {
        id: `template-${templates.length + 1}`,
        name: String(body?.name ?? ''),
        subject: String(body?.subject ?? ''),
        bodyHtml: String(body?.bodyHtml ?? ''),
        visibility: body?.visibility ?? 'PRIVATE',
        createdById: 'user-fixture',
        fieldsJson: null,
        createdAt: '2026-08-22T12:00:00.000Z',
        updatedAt: '2026-08-22T12:00:00.000Z',
      }
      templates.push(template)
      return route.fulfill({ status: 201, json: { template } })
    }
    if (request.method() === 'PATCH') {
      const template = templates.find((entry) => entry.id === templateId)
      if (!template) return route.fulfill({ status: 404, json: { error: 'Template not found' } })
      Object.assign(template, body)
      return route.fulfill({ json: { template } })
    }
    return route.fallback()
  })

  await page.setViewportSize({ width: 375, height: 800 })
  await page.goto('/__fixtures/email-templates')
  await expect(page.getByRole('heading', { name: 'Email templates' })).toBeVisible()
  await expect(page.getByText('Organization templates can be managed by their creator or an admin.')).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Template visibility' })).toHaveText('Private templates')
  await expect.poll(() => templateListRequests.some((url) =>
    url.searchParams.get('scope') === 'private' &&
    url.searchParams.get('sort') === 'name' &&
    url.searchParams.get('dir') === 'asc',
  )).toBe(true)

  await page.getByRole('button', { name: 'New template' }).click()
  const sharing = page.getByRole('checkbox', { name: 'Share with organization' })
  await expect(sharing).not.toBeChecked()
  await page.getByLabel(/^Name/).fill('Private follow-up')
  await page.getByRole('button', { name: 'Save template' }).click()
  await expect.poll(() => templateRequests).toHaveLength(1)
  expect(templateRequests[0]).toEqual({ method: 'POST', body: expect.objectContaining({ visibility: 'PRIVATE' }) })

  await page.getByRole('button', { name: 'New template' }).click()
  await page.getByLabel(/^Name/).fill('Shareable follow-up')
  await sharing.click()
  await page.getByRole('button', { name: 'Save template' }).click()
  await expect.poll(() => templateRequests).toHaveLength(2)
  expect(templateRequests[1]).toEqual({ method: 'POST', body: expect.objectContaining({ visibility: 'ORGANIZATION' }) })

  await page.getByRole('combobox', { name: 'Template visibility' }).click()
  await page.getByRole('option', { name: 'Private and organization templates' }).click()
  await expect.poll(() => templateListRequests.some((url) => url.searchParams.get('scope') === 'all')).toBe(true)

  const tableScroller = page.getByRole('table', { name: 'Email templates for Fixture organization' }).locator('..')
  await expect.poll(() => tableScroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  await tableScroller.evaluate((element) => { element.scrollLeft = element.scrollWidth })
  await page.getByRole('button', { name: 'Show actions for Shareable follow-up' }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  await expect(sharing).toBeChecked()
  await sharing.click()
  await expect(page.getByText('Teammates lose access. Emails already written from this template stay unchanged.')).toBeVisible()
  await page.getByRole('button', { name: 'Save template' }).click()
  await expect.poll(() => templateRequests).toHaveLength(3)
  expect(templateRequests[2]).toEqual({ method: 'PATCH', body: expect.objectContaining({ visibility: 'PRIVATE' }) })
  expect(draftRequests).toEqual([])

  await tableScroller.evaluate((element) => { element.scrollLeft = 0 })
  await page.getByRole('button', { name: 'Sort by Name' }).click()
  await expect.poll(() => templateListRequests.some((url) => url.searchParams.get('dir') === 'desc')).toBe(true)

  await page.getByLabel('Search templates').fill('Shareable')
  await expect.poll(() => templateListRequests.some((url) => url.searchParams.get('q') === 'Shareable')).toBe(true)

  await page.getByRole('button', { name: 'Use dark theme' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByRole('heading', { name: 'Email templates' })).toBeVisible()
  expect(consoleErrors).toEqual([])
})
