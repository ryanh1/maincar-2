import { expect, test } from '@playwright/test'

const list = {
  id: 'list-1', name: 'Q3 targets', slug: 'q3-targets', objectSlug: 'person', description: null,
  icon: null, ownerUserId: 'user-fixture', isShared: false, sortOrder: 0, isArchived: false,
  createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z',
}

const personObject = {
  id: 'person', slug: 'person', name: 'Person', namePlural: 'People', icon: null, iconColor: null,
  storage: 'table', isStandard: true, isFirstClass: true, isGridCreateSupported: false,
  capabilities: { list: true }, isHidden: false, isArchived: false,
  createdAt: list.createdAt, updatedAt: list.updatedAt,
}

const nameAttribute = {
  id: 'name', objectId: 'person', slug: 'name', name: 'Name', description: null, icon: null,
  type: 'text', optionsJson: null, refObjectId: null, formatJson: null, validationJson: null,
  isIdentity: true, storage: 'column', isMulti: false, isRequired: false, isUnique: false,
  isReadOnly: false, isSystem: true, defaultJson: null, sortOrder: 0, isArchived: false,
  createdAt: list.createdAt, updatedAt: list.updatedAt,
}

const priorityAttribute = {
  ...nameAttribute, id: 'priority', slug: 'priority', name: 'Priority', storage: 'list', isIdentity: false, sortOrder: 1,
}

test('opens a list with list-only fields and removes only its membership', async ({ page }) => {
  const consoleErrors: string[] = []
  const removedEntries: string[] = []
  let entries = [{
    id: 'entry-1', listId: list.id, objectSlug: 'person', targetId: 'person-1', values: { priority: 'High' }, position: 0,
    addedByUserId: 'user-fixture', createdAt: list.createdAt, updatedAt: list.updatedAt,
    target: { id: 'person-1', name: 'Ada Lovelace', createdAt: list.createdAt, updatedAt: list.updatedAt },
  }]
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.route('**/api/orgs/org-fixture/objects**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() === 'GET' && pathname.endsWith('/objects')) return route.fulfill({ json: { objects: [personObject] } })
    if (request.method() === 'GET' && pathname.endsWith('/objects/person')) return route.fulfill({ json: { object: { ...personObject, attributes: [nameAttribute, priorityAttribute] } } })
    return route.fallback()
  })
  await page.route('**/api/orgs/org-fixture/lists/list-1', (route) => route.fulfill({ json: { list } }))
  await page.route('**/api/orgs/org-fixture/lists/list-1/entries**', async (route) => {
    if (route.request().method() === 'DELETE') {
      removedEntries.push(route.request().url().split('/').at(-1)!)
      entries = []
      return route.fulfill({ status: 204 })
    }
    return route.fulfill({ json: { entries, total: entries.length, page: 1, limit: 100 } })
  })

  await page.goto('/__fixtures/lists/list-1')
  await expect(page.getByRole('heading', { name: /Q3 targets/ })).toBeVisible()
  const canvas = page.getByTestId('data-grid-canvas')
  await expect(canvas).toBeVisible()
  const bounds = await canvas.boundingBox()
  if (!bounds) throw new Error('The list grid canvas was not measurable.')

  await page.mouse.click(bounds.x + 422, bounds.y + 52)
  await expect(page.getByRole('heading', { name: 'Remove Ada Lovelace from this list?' })).toBeVisible()
  await page.getByRole('button', { name: 'Remove from list' }).click()

  await expect.poll(() => removedEntries).toEqual(['entry-1'])
  await expect(page.getByText('No records are in this list.')).toBeVisible()
  expect(consoleErrors).toEqual([])
})
