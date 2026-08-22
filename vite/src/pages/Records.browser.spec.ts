import { expect, test } from '@playwright/test'

const companyObject = {
  id: 'company', slug: 'company', name: 'Company', namePlural: 'Companies', icon: null, iconColor: null,
  storage: 'table', isStandard: true, isFirstClass: true, capabilities: { list: true }, isGridCreateSupported: true,
  isHidden: false, isArchived: false, createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z',
}

const nameAttribute = {
  id: 'name', objectId: 'company', slug: 'name', name: 'Name', description: null, icon: null,
  type: 'text', optionsJson: null, refObjectId: null, formatJson: null, validationJson: null,
  isIdentity: true, storage: 'column', isMulti: false, isRequired: false, isUnique: false,
  isReadOnly: false, isSystem: true, defaultJson: null, sortOrder: 0,
  isArchived: false, createdAt: companyObject.createdAt, updatedAt: companyObject.updatedAt,
}

test('creates a Company from its grid after a recoverable validation error', async ({ page }) => {
  const consoleErrors: string[] = []
  const companies: Array<Record<string, unknown>> = []
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('/companies failed:') && !message.text().includes('status of 422')) consoleErrors.push(message.text())
  })

  await page.route('**/api/orgs/org-fixture/objects**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() === 'GET' && pathname.endsWith('/objects')) {
      return route.fulfill({ json: { objects: [companyObject] } })
    }
    if (request.method() === 'GET' && pathname.endsWith('/objects/company')) {
      return route.fulfill({ json: { object: { ...companyObject, attributes: [nameAttribute] } } })
    }
    if (request.method() === 'POST' && pathname.endsWith('/objects/company/list')) {
      return route.fulfill({ json: { rows: companies, nextCursor: null, totalCount: companies.length } })
    }
    return route.fallback()
  })
  await page.route('**/api/orgs/org-fixture/companies', async (route) => {
    const body = route.request().postDataJSON() as { name?: string }
    if (!body.name) return route.fulfill({ status: 422, json: { error: 'A company needs at least one of a name, a domain, or a LinkedIn URL.' } })
    const company = { id: 'company-1', name: body.name, createdAt: companyObject.createdAt, updatedAt: companyObject.updatedAt }
    companies.push(company)
    return route.fulfill({ status: 201, json: { company } })
  })

  await page.goto('/__fixtures/records/company')
  await expect(page.getByRole('button', { name: 'Create Company' })).toBeVisible()

  await page.getByRole('button', { name: 'Create Company' }).click()
  await page.getByRole('button', { name: 'Save Company' }).click()
  await expect(page.getByRole('alert')).toHaveText('A company needs at least one of a name, a domain, or a LinkedIn URL.')

  await page.getByRole('textbox', { name: 'Name' }).fill('Acme')
  await page.getByRole('button', { name: 'Save Company' }).click()
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveCount(0)
  await expect(page.getByTestId('data-grid-canvas')).toBeVisible()
  expect(companies).toEqual([expect.objectContaining({ id: 'company-1', name: 'Acme' })])
  expect(consoleErrors).toEqual([])
})

test('keeps an unsupported direct object URL out of the grid and list API', async ({ page }) => {
  const consoleErrors: string[] = []
  const listRequests: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('request', (request) => {
    if (request.url().includes('/api/') && request.url().endsWith('/list')) listRequests.push(request.url())
  })

  await page.route('**/api/orgs/org-fixture/objects', (route) =>
    route.fulfill({
      json: {
        objects: [
          {
            id: 'email-object', slug: 'email', namePlural: 'Emails', isHidden: false,
            isArchived: false, capabilities: { list: false },
          },
        ],
      },
    }),
  )

  await page.goto('/__fixtures/records/email')

  await expect(page.getByRole('heading', { name: 'Emails' })).toBeVisible()
  await expect(page.getByText('This object is unavailable. Choose another object.')).toBeVisible()
  await expect(page.getByRole('grid')).toHaveCount(0)
  expect(listRequests).toEqual([])
  expect(consoleErrors).toEqual([])
})
