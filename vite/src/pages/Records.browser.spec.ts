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

test('selects loaded Companies, extends to the filtered view, and exports through the bulk endpoint', async ({ page }) => {
  const rows = [
    { id: 'company-1', name: 'Ada', createdAt: companyObject.createdAt, updatedAt: companyObject.updatedAt },
    { id: 'company-2', name: 'Grace', createdAt: companyObject.createdAt, updatedAt: companyObject.updatedAt },
  ]
  const actions: Array<Record<string, unknown>> = []
  await page.route('**/api/orgs/org-fixture/objects**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (route.request().method() === 'GET' && pathname.endsWith('/objects')) return route.fulfill({ json: { objects: [companyObject] } })
    if (route.request().method() === 'GET' && pathname.endsWith('/objects/company')) return route.fulfill({ json: { object: { ...companyObject, attributes: [nameAttribute] } } })
    if (route.request().method() === 'POST' && pathname.endsWith('/objects/company/list')) return route.fulfill({ json: { rows, nextCursor: null, totalCount: 100 } })
    if (route.request().method() === 'POST' && pathname.endsWith('/objects/company/bulk')) {
      actions.push(route.request().postDataJSON() as Record<string, unknown>)
      return route.fulfill({ json: { rows, totalCount: 100 } })
    }
    return route.fallback()
  })
  await page.route('**/api/orgs/org-fixture/saved-views**', (route) => route.fulfill({ json: { views: [] } }))
  await page.route('**/api/orgs/org-fixture/lists', (route) => route.fulfill({ json: { lists: [], total: 0, page: 1, limit: 100 } }))
  await page.route('**/api/orgs/org-fixture/members**', (route) => route.fulfill({ json: { members: [], total: 0, page: 1, limit: 200, meta: { activeAdminCount: 0 }, viewerRoles: ['basic'] } }))

  await page.goto('/__fixtures/records/company')
  const canvas = page.getByTestId('data-grid-canvas')
  await expect(canvas).toBeVisible()
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('The record grid canvas was not measurable.')
  await page.mouse.click(bounds.x + 16, bounds.y + 18)
  await expect(page.getByText('All 2 on screen are selected.')).toBeVisible()
  await page.getByRole('button', { name: 'Select all 100 in this view' }).click()
  await expect(page.getByText('100 selected')).toBeVisible()
  await page.getByRole('button', { name: 'Export' }).click()
  await expect.poll(() => actions).toEqual([{ selection: { mode: 'filter' }, action: { type: 'export' } }])
})

test('adds selected Companies to a newly created list', async ({ page }) => {
  const rows = [
    { id: 'company-1', name: 'Ada', createdAt: companyObject.createdAt, updatedAt: companyObject.updatedAt },
    { id: 'company-2', name: 'Grace', createdAt: companyObject.createdAt, updatedAt: companyObject.updatedAt },
  ]
  const createdLists: Array<Record<string, unknown>> = []
  const actions: Array<Record<string, unknown>> = []

  await page.route('**/api/orgs/org-fixture/objects**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (route.request().method() === 'GET' && pathname.endsWith('/objects')) return route.fulfill({ json: { objects: [companyObject] } })
    if (route.request().method() === 'GET' && pathname.endsWith('/objects/company')) return route.fulfill({ json: { object: { ...companyObject, attributes: [nameAttribute] } } })
    if (route.request().method() === 'POST' && pathname.endsWith('/objects/company/list')) return route.fulfill({ json: { rows, nextCursor: null, totalCount: rows.length } })
    if (route.request().method() === 'POST' && pathname.endsWith('/objects/company/bulk')) {
      actions.push(route.request().postDataJSON() as Record<string, unknown>)
      return route.fulfill({ json: { affectedCount: rows.length } })
    }
    return route.fallback()
  })
  await page.route('**/api/orgs/org-fixture/lists**', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') return route.fulfill({ json: { lists: createdLists, total: createdLists.length, page: 1, limit: 100 } })
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as { name: string; objectSlug: string }
      const list = { id: 'list-new', name: body.name, slug: 'priority-companies', objectSlug: body.objectSlug, description: null, icon: null, ownerUserId: 'user-fixture', isShared: false, sortOrder: 0, isArchived: false, createdAt: companyObject.createdAt, updatedAt: companyObject.updatedAt }
      createdLists.push(list)
      return route.fulfill({ status: 201, json: { list } })
    }
    return route.fallback()
  })
  await page.route('**/api/orgs/org-fixture/saved-views**', (route) => route.fulfill({ json: { views: [] } }))
  await page.route('**/api/orgs/org-fixture/members**', (route) => route.fulfill({ json: { members: [], total: 0, page: 1, limit: 200, meta: { activeAdminCount: 0 }, viewerRoles: ['basic'] } }))

  await page.goto('/__fixtures/records/company')
  const canvas = page.getByTestId('data-grid-canvas')
  await expect(canvas).toBeVisible()
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('The record grid canvas was not measurable.')
  await page.mouse.click(bounds.x + 16, bounds.y + 18)
  await page.getByRole('button', { name: 'Add to list' }).click()
  await page.getByRole('button', { name: 'New list' }).click()
  await page.getByRole('textbox', { name: 'List name' }).fill('Priority companies')
  await page.getByRole('button', { name: 'Create list' }).click()

  await expect.poll(() => createdLists).toEqual([expect.objectContaining({ name: 'Priority companies', objectSlug: 'company' })])
  await expect.poll(() => actions).toEqual([{
    selection: { mode: 'ids', ids: ['company-1', 'company-2'] },
    action: { type: 'addToList', listId: 'list-new' },
  }])
})

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

test('copies a multi-cell Company selection as TSV and pastes it into another range', async ({ page }) => {
  const consoleErrors: string[] = []
  const updates: Array<{ id: string; body: Record<string, unknown> }> = []
  const rows = [
    { id: 'company-1', name: 'Ada', domain: 'ada.example' },
    { id: 'company-2', name: 'Grace', domain: 'grace.example' },
    { id: 'company-3', name: null, domain: null },
    { id: 'company-4', name: null, domain: null },
  ]

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.route('**/api/orgs/org-fixture/objects**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (route.request().method() === 'GET' && pathname.endsWith('/objects')) {
      return route.fulfill({ json: { objects: [companyObject] } })
    }
    if (route.request().method() === 'GET' && pathname.endsWith('/objects/company')) {
      return route.fulfill({ json: { object: { ...companyObject, attributes: [nameAttribute, domainAttribute] } } })
    }
    if (route.request().method() === 'POST' && pathname.endsWith('/objects/company/list')) {
      return route.fulfill({ json: { rows, nextCursor: null, totalCount: rows.length } })
    }
    return route.fallback()
  })
  await page.route('**/api/orgs/org-fixture/companies/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    updates.push({
      id: route.request().url().split('/').at(-1)!,
      body: route.request().postDataJSON() as Record<string, unknown>,
    })
    return route.fulfill({ json: {} })
  })
  await page.route('**/api/orgs/org-fixture/saved-views**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { views: [] } })
    return route.fallback()
  })

  await page.goto('/__fixtures/records/company')
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin })

  const canvas = page.getByTestId('data-grid-canvas')
  await expect(canvas).toBeVisible()
  const bounds = await canvas.boundingBox()
  expect(bounds).not.toBeNull()
  if (!bounds) throw new Error('The record grid canvas was not measurable.')

  const rowCenter = (row: number) => bounds.y + 32 + (row * 34) + 17
  await page.mouse.click(bounds.x + 80, rowCenter(0))
  await page.keyboard.down('Shift')
  await page.mouse.click(bounds.x + 300, rowCenter(1))
  await page.keyboard.up('Shift')
  await page.keyboard.press('ControlOrMeta+c')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('Ada\tada.example\nGrace\tgrace.example')
  await page.mouse.click(bounds.x + 80, rowCenter(2))
  await page.keyboard.press('ControlOrMeta+v')

  await expect.poll(() => updates).toEqual(expect.arrayContaining([
    { id: 'company-3', body: { name: 'Ada' } },
    { id: 'company-3', body: { domain: 'ada.example' } },
    { id: 'company-4', body: { name: 'Grace' } },
    { id: 'company-4', body: { domain: 'grace.example' } },
  ]))
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
  const deals = [
    { id: 'deal-1', name: 'Northstar', pipelineStage: 'discovery', amount: 5000, createdAt: '', updatedAt: '' },
    { id: 'deal-4', name: 'Bluebird', pipelineStage: 'discovery', amount: 8000, createdAt: '', updatedAt: '' },
    { id: 'deal-2', name: 'Acme', pipelineStage: 'proposal', amount: 12000, createdAt: '', updatedAt: '' },
    { id: 'deal-3', name: 'Unqualified', pipelineStage: null, amount: 700, createdAt: '', updatedAt: '' },
  ]
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
      return route.fulfill({ json: { rows: deals, nextCursor: null, totalCount: deals.length } })
    }
    return route.fallback()
  })
  await page.route('**/api/orgs/org-fixture/deals/*', async (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    const body = route.request().postDataJSON() as { pipelineStage?: string }
    const deal = deals.find((candidate) => candidate.id === route.request().url().split('/').at(-1))
    if (deal && body.pipelineStage) deal.pipelineStage = body.pipelineStage
    patchBodies.push(body)
    return route.fulfill({ json: { deal } })
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
  await expect(page.getByRole('heading', { name: 'Discovery 2 records' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Proposal 1 records' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'No value 1 records' })).toBeVisible()
  await expect(page.getByText('Northstar')).toBeVisible()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect.poll(() => patchBodies).toEqual([
    expect.objectContaining({ layout: 'kanban' }),
    expect.objectContaining({ config: expect.objectContaining({ kanban: expect.objectContaining({ groupAttributeId: 'pipeline-stage' }) }) }),
  ])

  const discoveryCards = page.getByLabel('Discovery cards')
  const northstar = page.getByText('Northstar').locator('xpath=..')
  const bluebird = page.getByText('Bluebird').locator('xpath=..')
  const northstarBounds = await northstar.boundingBox()
  const bluebirdBounds = await bluebird.boundingBox()
  if (!northstarBounds || !bluebirdBounds) throw new Error('The Kanban cards were not measurable.')
  await page.mouse.move(northstarBounds.x + (northstarBounds.width / 2), northstarBounds.y + (northstarBounds.height / 2))
  await page.mouse.down()
  await page.mouse.move(bluebirdBounds.x + (bluebirdBounds.width / 2), bluebirdBounds.y + (bluebirdBounds.height / 2), { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => discoveryCards.locator('h3').allTextContents()).toEqual(['Bluebird', 'Northstar'])

  const proposalCards = page.getByLabel('Proposal cards')
  const proposalBounds = await proposalCards.boundingBox()
  const reorderedNorthstarBounds = await northstar.boundingBox()
  if (!reorderedNorthstarBounds || !proposalBounds) throw new Error('The Kanban cards were not measurable.')
  await page.mouse.move(reorderedNorthstarBounds.x + (reorderedNorthstarBounds.width / 2), reorderedNorthstarBounds.y + (reorderedNorthstarBounds.height / 2))
  await page.mouse.down()
  await page.mouse.move(proposalBounds.x + (proposalBounds.width / 2), proposalBounds.y + (proposalBounds.height / 2), { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => patchBodies.at(-1)).toEqual({ pipelineStage: 'proposal' })
  await expect(page.getByRole('heading', { name: 'Discovery 1 records' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Proposal 2 records' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Discovery 1 records' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Proposal 2 records' })).toBeVisible()
  expect(consoleErrors).toEqual([])
})

test('manages a saved view without changing its records', async ({ page }) => {
  const consoleErrors: string[] = []
  const requests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = []
  let deletedView: Record<string, unknown> | null = null
  const views: Array<Record<string, unknown>> = [
    {
      id: 'personal', objectId: 'company', name: 'My view', layout: 'grid', config: { version: 1, columns: [], sorts: [], groupBy: [], rowHeight: 'compact', gridLines: true, frozenRows: 0, frozenCols: 1, zoom: 100, columnWidths: {}, columnStyles: [] },
      ownerUserId: 'user-fixture', isShared: false, isDefault: false, sortOrder: 0, createdAt: companyObject.createdAt, updatedAt: companyObject.updatedAt,
    },
    {
      id: 'default', objectId: 'company', name: 'Default view', layout: 'grid', config: { version: 1, columns: [], sorts: [], groupBy: [], rowHeight: 'compact', gridLines: true, frozenRows: 0, frozenCols: 1, zoom: 100, columnWidths: {}, columnStyles: [] },
      ownerUserId: 'user-fixture', isShared: false, isDefault: true, sortOrder: 1, createdAt: companyObject.createdAt, updatedAt: companyObject.updatedAt,
    },
  ]
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await page.route('**/api/orgs/org-fixture/objects**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (route.request().method() === 'GET' && pathname.endsWith('/objects')) return route.fulfill({ json: { objects: [companyObject] } })
    if (route.request().method() === 'GET' && pathname.endsWith('/objects/company')) return route.fulfill({ json: { object: { ...companyObject, attributes: [nameAttribute] } } })
    if (route.request().method() === 'POST' && pathname.endsWith('/objects/company/list')) return route.fulfill({ json: { rows: [], nextCursor: null, totalCount: 0 } })
    return route.fallback()
  })
  await page.route('**/api/orgs/org-fixture/saved-views**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : undefined
    requests.push({ method: request.method(), path: pathname, body })
    if (request.method() === 'GET' && pathname.endsWith('/saved-views')) return route.fulfill({ json: { views } })
    if (request.method() === 'POST' && pathname.endsWith('/saved-views/reorder')) {
      const viewIds = body?.viewIds as string[]
      const order = new Map(viewIds.map((id, index) => [id, index]))
      views.sort((left, right) => order.get(String(left.id))! - order.get(String(right.id))!)
      return route.fulfill({ status: 204 })
    }
    const pathParts = pathname.split('/')
    const viewId = pathParts.at(-2) === 'saved-views' ? pathParts.at(-1) : pathParts.at(-2)
    const view = views.find((candidate) => candidate.id === viewId)
    if (request.method() === 'PATCH' && view) {
      Object.assign(view, body)
      return route.fulfill({ json: { view } })
    }
    if (request.method() === 'POST' && pathname.endsWith('/duplicate') && view) {
      const copy = { ...view, id: 'copy', name: `${view.name} copy`, isShared: false, isDefault: false, sortOrder: views.length }
      views.push(copy)
      return route.fulfill({ status: 201, json: { view: copy } })
    }
    if (request.method() === 'POST' && pathname.endsWith('/default') && view) {
      views.forEach((candidate) => { candidate.isDefault = candidate.id === view.id })
      return route.fulfill({ status: 204 })
    }
    if (request.method() === 'DELETE' && view) {
      deletedView = { ...view }
      views.splice(views.indexOf(view), 1)
      return route.fulfill({ status: 204 })
    }
    if (request.method() === 'POST' && pathname.endsWith('/restore') && deletedView) {
      views.push(deletedView)
      return route.fulfill({ status: 204 })
    }
    return route.fallback()
  })

  await page.goto('/__fixtures/records/company')
  await page.getByRole('combobox', { name: 'Saved view' }).click()
  await page.getByRole('option', { name: 'My view' }).click()

  await page.getByRole('button', { name: 'Show actions for My view view' }).click()
  await page.getByRole('menuitem', { name: 'Rename view' }).click()
  await page.getByRole('textbox', { name: 'Saved view name' }).fill('Q3 prospects')
  await page.getByRole('textbox', { name: 'Saved view name' }).press('Enter')
  await expect.poll(() => requests).toContainEqual(expect.objectContaining({ method: 'PATCH', path: '/api/orgs/org-fixture/saved-views/personal', body: { name: 'Q3 prospects' } }))

  await page.getByRole('button', { name: 'Show actions for Q3 prospects view' }).click()
  await page.getByRole('menuitem', { name: 'Share with everyone' }).click()
  await page.getByRole('button', { name: 'Share view' }).click()
  await expect.poll(() => requests).toContainEqual(expect.objectContaining({ method: 'PATCH', path: '/api/orgs/org-fixture/saved-views/personal', body: { isShared: true } }))

  await page.getByRole('button', { name: 'Show actions for Q3 prospects view' }).click()
  await page.getByRole('menuitem', { name: 'Set as default' }).click()
  await expect.poll(() => requests).toContainEqual(expect.objectContaining({ method: 'POST', path: '/api/orgs/org-fixture/saved-views/personal/default' }))

  await page.getByRole('button', { name: 'Show actions for Q3 prospects view' }).click()
  await page.getByRole('menuitem', { name: 'Duplicate view' }).click()
  await expect.poll(() => requests).toContainEqual(expect.objectContaining({ method: 'POST', path: '/api/orgs/org-fixture/saved-views/personal/duplicate' }))

  await page.getByRole('button', { name: 'Show actions for Q3 prospects copy view' }).click()
  await page.getByRole('menuitem', { name: 'Reorder views' }).click()
  await expect(page.getByRole('dialog', { name: 'Reorder views' })).toBeVisible()
  const copyHandle = page.getByRole('button', { name: 'Reorder Q3 prospects copy view' })
  const defaultHandle = page.getByRole('button', { name: 'Reorder Default view view' })
  const copyBounds = await copyHandle.boundingBox()
  const defaultBounds = await defaultHandle.boundingBox()
  if (!copyBounds || !defaultBounds) throw new Error('Saved-view reorder handles were not measurable.')
  await page.mouse.move(copyBounds.x + (copyBounds.width / 2), copyBounds.y + (copyBounds.height / 2))
  await page.mouse.down()
  await page.mouse.move(defaultBounds.x + (defaultBounds.width / 2), defaultBounds.y + (defaultBounds.height / 2), { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => requests).toContainEqual(expect.objectContaining({
    method: 'POST', path: '/api/orgs/org-fixture/saved-views/reorder', body: { objectId: 'company', viewIds: ['personal', 'copy', 'default'] },
  }))
  await page.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('combobox', { name: 'Saved view' }).click()
  await page.getByRole('option', { name: 'Q3 prospects copy' }).click()
  await page.getByRole('button', { name: 'Show actions for Q3 prospects copy view' }).click()
  await page.getByRole('menuitem', { name: 'Delete view' }).click()
  await expect.poll(() => requests).toContainEqual(expect.objectContaining({ method: 'DELETE', path: '/api/orgs/org-fixture/saved-views/copy' }))
  expect(consoleErrors).toEqual([])
})
