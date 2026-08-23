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

const domainAttribute = {
  ...nameAttribute,
  id: 'domain', slug: 'domain', name: 'Domain', isIdentity: false, sortOrder: 1,
}

const rankAttribute = {
  ...nameAttribute,
  id: 'rank', slug: 'rank', name: 'Rank', type: 'number', isIdentity: false,
}

const dealObject = { ...companyObject, id: 'deal', slug: 'deal', name: 'Deal', namePlural: 'Deals', isGridCreateSupported: false }
const dealNameAttribute = { ...nameAttribute, objectId: 'deal', id: 'deal-name', slug: 'name', name: 'Deal' }
const pipelineStageAttribute = {
  ...nameAttribute, objectId: 'deal', id: 'pipeline-stage', slug: 'pipelineStage', name: 'Pipeline stage', isIdentity: false, type: 'status', sortOrder: 1,
  optionsJson: [
    { value: 'discovery', label: 'Discovery', color: 'option-1', order: 0 },
    { value: 'proposal', label: 'Proposal', color: 'option-2', order: 1 },
  ],
}
const amountAttribute = { ...nameAttribute, objectId: 'deal', id: 'amount', slug: 'amount', name: 'Amount', isIdentity: false, type: 'currency', sortOrder: 2 }

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
      return route.fulfill({ json: { object: { ...companyObject, attributes: [nameAttribute, domainAttribute] } } })
    }
    if (request.method() === 'POST' && pathname.endsWith('/objects/company/list')) {
      return route.fulfill({ json: { rows: companies, nextCursor: null, totalCount: companies.length } })
    }
    return route.fallback()
  })
  await page.route('**/api/orgs/org-fixture/saved-views**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { views: [] } })
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
  await expect(page.getByRole('button', { name: 'New' })).toBeVisible()

  await page.getByRole('button', { name: 'New' }).click()
  await page.getByRole('button', { name: 'Save Company' }).click()
  await expect(page.getByRole('alert')).toHaveText('A company needs at least one of a name, a domain, or a LinkedIn URL.')

  await page.getByRole('textbox', { name: 'Name' }).fill('Acme')
  await page.getByRole('button', { name: 'Save Company' }).click()
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveCount(0)
  await expect(page.getByTestId('data-grid-canvas')).toBeVisible()
  expect(companies).toEqual([expect.objectContaining({ id: 'company-1', name: 'Acme' })])

  const gridBounds = await page.getByTestId('data-grid-canvas').boundingBox()
  if (!gridBounds) throw new Error('The grid canvas did not have bounds')
  await page.mouse.click(gridBounds.x + 80, gridBounds.y + 18)
  await page.keyboard.down('Shift')
  await page.mouse.click(gridBounds.x + 300, gridBounds.y + 18)
  await page.keyboard.up('Shift')
  await page.getByRole('textbox', { name: 'Column group name' }).fill('Identity')
  await page.getByRole('button', { name: 'Group columns' }).click()
  await expect(page.getByRole('button', { name: 'Collapse Identity column group' })).toBeVisible()
  await page.getByRole('button', { name: 'Collapse Identity column group' }).click()
  await expect(page.getByRole('button', { name: 'Expand Identity column group' })).toBeVisible()

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
  await page.route('**/api/orgs/org-fixture/saved-views**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { views: [] } })
    return route.fallback()
  })

  await page.goto('/__fixtures/records/email')

  await expect(page.getByRole('heading', { name: 'Emails' })).toBeVisible()
  await expect(page.getByText('This object is unavailable. Choose another object.')).toBeVisible()
  await expect(page.getByRole('grid')).toHaveCount(0)
  expect(listRequests).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('fills the selected Company grid rows down with Ctrl+D', async ({ page }) => {
  const updates: Array<{ id: string; value: unknown }> = []
  const rows = [
    { id: 'company-1', rank: 1 },
    { id: 'company-2', rank: null },
    { id: 'company-3', rank: null },
    { id: 'company-4', rank: null },
  ]

  await page.route('**/api/orgs/org-fixture/objects**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (route.request().method() === 'GET' && pathname.endsWith('/objects')) {
      return route.fulfill({ json: { objects: [companyObject] } })
    }
    if (route.request().method() === 'GET' && pathname.endsWith('/objects/company')) {
      return route.fulfill({ json: { object: { ...companyObject, attributes: [rankAttribute] } } })
    }
    if (route.request().method() === 'POST' && pathname.endsWith('/objects/company/list')) {
      return route.fulfill({ json: { rows, nextCursor: null, totalCount: rows.length } })
    }
    return route.fallback()
  })
  await page.route('**/api/orgs/org-fixture/companies/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    const body = route.request().postDataJSON() as { rank?: unknown }
    updates.push({ id: route.request().url().split('/').at(-1)!, value: body.rank })
    return route.fulfill({ json: {} })
  })
  await page.route('**/api/orgs/org-fixture/saved-views**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { views: [] } })
    return route.fallback()
  })

  await page.goto('/__fixtures/records/company')
  const canvas = page.getByTestId('data-grid-canvas')
  await expect(canvas).toBeVisible()
  const bounds = await canvas.boundingBox()
  expect(bounds).not.toBeNull()
  if (!bounds) throw new Error('The record grid canvas was not measurable.')

  const rowCenter = (row: number) => bounds.y + 32 + (row * 34) + 17
  await page.mouse.click(bounds.x + 80, rowCenter(0))
  await page.keyboard.down('Shift')
  await page.mouse.click(bounds.x + 80, rowCenter(3))
  await page.keyboard.up('Shift')
  await page.keyboard.press('Control+d')

  await expect.poll(() => updates).toEqual([
    { id: 'company-2', value: 1 },
    { id: 'company-3', value: 1 },
    { id: 'company-4', value: 1 },
  ])
})

test('saves the live URL sort into the synthesized default view and reloads it', async ({ page }) => {
  const consoleErrors: string[] = []
  const views: Array<Record<string, unknown>> = []
  const listBodies: Array<Record<string, unknown>> = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.route('**/api/orgs/org-fixture/objects**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() === 'GET' && pathname.endsWith('/objects')) return route.fulfill({ json: { objects: [companyObject] } })
    if (request.method() === 'GET' && pathname.endsWith('/objects/company')) return route.fulfill({ json: { object: { ...companyObject, attributes: [nameAttribute] } } })
    if (request.method() === 'POST' && pathname.endsWith('/objects/company/list')) {
      listBodies.push(request.postDataJSON() as Record<string, unknown>)
      return route.fulfill({ json: { rows: [], nextCursor: null, totalCount: 0 } })
    }
    return route.fallback()
  })
  await page.route('**/api/orgs/org-fixture/saved-views**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() === 'GET' && pathname.endsWith('/saved-views')) return route.fulfill({ json: { views } })
    if (request.method() === 'POST' && pathname.endsWith('/saved-views')) {
      const body = request.postDataJSON() as { config: Record<string, unknown>; name: string }
      const view = {
        id: 'view-1', objectId: 'company', name: body.name, layout: 'grid', config: body.config,
        ownerUserId: 'user-fixture', isShared: false, isDefault: false, sortOrder: 0,
        createdAt: companyObject.createdAt, updatedAt: companyObject.updatedAt,
      }
      views.push(view)
      return route.fulfill({ status: 201, json: { view } })
    }
    if (request.method() === 'POST' && pathname.endsWith('/saved-views/view-1/default')) {
      views[0].isDefault = true
      return route.fulfill({ status: 204 })
    }
    return route.fallback()
  })

  const liveSort = btoa(JSON.stringify({ version: 1, sorts: [{ attributeId: 'name', direction: 'asc' }] }))
  await page.goto(`/__fixtures/records/company?v=${encodeURIComponent(liveSort)}`)
  const canvas = page.getByTestId('data-grid-canvas')
  await expect(canvas).toBeVisible()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect.poll(() => views[0]?.isDefault).toBe(true)
  expect(views[0]).toMatchObject({ config: { sorts: [{ attributeId: 'name', direction: 'asc' }] } })

  await page.goto('/__fixtures/records/company')
  await expect(canvas).toBeVisible()
  await expect.poll(() => listBodies.at(-1)).toMatchObject({ sort: { field: 'name', direction: 'asc' } })
  await expect(page.getByRole('combobox', { name: 'Saved view' })).toHaveText('Default view')
  expect(consoleErrors).toEqual([])
})

test('renders Deals as a persisted Kanban board grouped by pipeline stage', async ({ page }) => {
  const consoleErrors: string[] = []
  const patchBodies: Array<Record<string, unknown>> = []
  const attributes = [dealNameAttribute, pipelineStageAttribute, amountAttribute]
  const config = {
    columns: attributes.map((attribute, order) => ({ attributeId: attribute.id, visible: true, order })),
    sorts: [], groupBy: [], rowHeight: 'compact', gridLines: true, frozenRows: 0, frozenCols: 1, zoom: 100, columnWidths: {}, columnStyles: [],
  }
  const view: Record<string, unknown> = {
    id: 'deals-view', objectId: 'deal', name: 'Pipeline', layout: 'grid', config,
    ownerUserId: 'user-fixture', isShared: false, isDefault: true, sortOrder: 0, createdAt: dealObject.createdAt, updatedAt: dealObject.updatedAt,
  }
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.route('**/api/orgs/org-fixture/objects**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() === 'GET' && pathname.endsWith('/objects')) return route.fulfill({ json: { objects: [dealObject] } })
    if (request.method() === 'GET' && pathname.endsWith('/objects/deal')) return route.fulfill({ json: { object: { ...dealObject, attributes } } })
    if (request.method() === 'POST' && pathname.endsWith('/objects/deal/list')) {
      return route.fulfill({ json: { rows: [
        { id: 'deal-1', name: 'Northstar', pipelineStage: 'discovery', amount: 5000, createdAt: '', updatedAt: '' },
        { id: 'deal-2', name: 'Acme', pipelineStage: 'proposal', amount: 12000, createdAt: '', updatedAt: '' },
        { id: 'deal-3', name: 'Unqualified', pipelineStage: null, amount: 700, createdAt: '', updatedAt: '' },
      ], nextCursor: null, totalCount: 3 } })
    }
    return route.fallback()
  })
  await page.route('**/api/orgs/org-fixture/saved-views**', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') return route.fulfill({ json: { views: [view] } })
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>
      patchBodies.push(body)
      if (body.layout) view.layout = body.layout
      if (body.config) view.config = body.config
      return route.fulfill({ json: { view } })
    }
    return route.fallback()
  })

  await page.goto('/__fixtures/records/deal')
  await expect(page.getByTestId('data-grid-canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Kanban' }).click()
  await expect(page.getByRole('heading', { name: 'Discovery 1' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Proposal 1' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No value 1' })).toBeVisible()
  await expect(page.getByText('Northstar')).toBeVisible()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect.poll(() => patchBodies).toEqual([
    expect.objectContaining({ layout: 'kanban' }),
    expect.objectContaining({ config: expect.objectContaining({ groupBy: [{ attributeId: 'pipeline-stage', direction: 'asc' }] }) }),
  ])

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Discovery 1' })).toBeVisible()
  expect(consoleErrors).toEqual([])
})
