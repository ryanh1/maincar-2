import { expect, test, type Page } from '@playwright/test'

const createdAt = '2026-08-01T12:00:00.000Z'
const companyObject = {
  id: 'company-object', slug: 'company', name: 'Company', namePlural: 'Companies', icon: 'building-2', iconColor: 'option-2',
  storage: 'table', isStandard: true, isFirstClass: true, isGridCreateSupported: true, capabilities: { list: true },
  isHidden: false, isArchived: false, createdAt, updatedAt: createdAt,
}
const dealObject = {
  ...companyObject, id: 'deal-object', slug: 'deal', name: 'Deal', namePlural: 'Deals', icon: 'circle-dollar-sign', iconColor: 'option-3',
}
const personObject = {
  ...companyObject, id: 'person-object', slug: 'person', name: 'Person', namePlural: 'People', icon: 'user', iconColor: 'option-1',
}
const nameAttribute = {
  id: 'name', objectId: companyObject.id, slug: 'name', name: 'Name', description: null, icon: null, type: 'text',
  optionsJson: null, refObjectId: null, formatJson: null, validationJson: null, isIdentity: true, storage: 'column',
  isMulti: false, isRequired: false, isUnique: false, isReadOnly: false, isSystem: true, defaultJson: null,
  sortOrder: 0, isArchived: false, createdAt, updatedAt: createdAt,
}

function eventFor(rootType: 'company' | 'deal') {
  return {
    id: `${rootType}-event`, sourceType: 'task', sourceId: `${rootType}-task`, title: 'Prepare renewal brief',
    preview: 'Share the brief before the next call.', subtype: null, intensity: 2,
    display: { actorName: 'Fixture Rep', personName: 'Ada Lovelace', dealName: 'Enterprise renewal' },
    marker: null, direction: 'outbound', occurredAt: '2026-08-22T18:00:00.000Z',
    companyId: 'company-1', personId: 'person-1', dealId: 'deal-1',
  }
}

async function mockRecordPage(page: Page) {
  const timelineRequests: URL[] = []
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.route('**/api/orgs/org-fixture/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (request.method() === 'GET' && path.endsWith('/objects')) {
      return route.fulfill({ json: { objects: [companyObject, dealObject] } })
    }
    const object = path.includes('deal-object') ? dealObject : companyObject
    if (request.method() === 'GET' && path.endsWith(`/objects/${object.id}`)) {
      return route.fulfill({ json: { object: { ...object, attributes: [{ ...nameAttribute, objectId: object.id }] } } })
    }
    if (request.method() === 'POST' && path.endsWith(`/objects/${object.id}/list`)) {
      const isDeal = object.slug === 'deal'
      return route.fulfill({ json: { rows: [{ id: isDeal ? 'deal-1' : 'company-1', name: isDeal ? 'Enterprise renewal' : 'Acme', createdAt, updatedAt: createdAt }], nextCursor: null, totalCount: 1 } })
    }
    if (request.method() === 'GET' && path.endsWith('/objects/company-object/records/company-1/related')) {
      return route.fulfill({ json: { related: [
        {
          id: 'inbound:person-object:companyId', label: 'People', direction: 'inbound', attributeName: 'Company', count: 1,
          object: { ...personObject, attributes: [{ ...nameAttribute, objectId: personObject.id }] },
          records: [{ id: 'person-1', name: 'Ada Lovelace', createdAt, updatedAt: createdAt }],
        },
        {
          id: 'inbound:deal-object:companyId', label: 'Deals', direction: 'inbound', attributeName: 'Company', count: 1,
          object: { ...dealObject, attributes: [{ ...nameAttribute, objectId: dealObject.id }] },
          records: [{ id: 'deal-1', name: 'Enterprise renewal', createdAt, updatedAt: createdAt }],
        },
      ] } })
    }
    if (request.method() === 'GET' && path.endsWith(`/detail-layouts/${object.id}`)) {
      return route.fulfill({ json: { layout: { objectId: object.id, sections: [{ name: 'Details', order: 0, fields: [{ slug: 'name', width: 2 }] }], railObjects: [], feedKinds: [], isDefault: true } } })
    }
    if (request.method() === 'GET' && path.endsWith('/activity')) {
      return route.fulfill({ json: { activity: [] } })
    }
    if (request.method() === 'GET' && path.includes('/account-timeline/')) {
      const rootType = url.searchParams.get('rootType') as 'company' | 'deal'
      return route.fulfill({ json: {
        event: eventFor(rootType),
        detail: { type: 'task', id: `${rootType}-task`, title: 'Prepare renewal brief', isDone: false },
        navigation: { previousEventId: null, nextEventId: null },
      } })
    }
    if (request.method() === 'GET' && path.endsWith('/account-timeline')) {
      timelineRequests.push(url)
      const rootType = url.searchParams.get('rootType') as 'company' | 'deal'
      return route.fulfill({ json: {
        events: [eventFor(rootType)],
        nextCursor: null,
        range: {
          from: url.searchParams.get('occurredFrom') ?? '2026-08-01T00:00:00.000Z',
          to: url.searchParams.get('occurredTo') ?? '2026-09-01T00:00:00.000Z',
          isDefault: !url.searchParams.has('occurredFrom'),
        },
      } })
    }
    return route.fulfill({ status: 404, json: { error: `Unhandled fixture route: ${request.method()} ${path}` } })
  })
  return { timelineRequests, consoleErrors }
}

test('reaches the scoped Company timeline and preserves its controls across record views and widths', async ({ page }) => {
  const { timelineRequests, consoleErrors } = await mockRecordPage(page)
  await page.goto('/__fixtures/records/company/company-1')

  await expect(page.getByRole('heading', { name: 'Acme' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Companies' })).toHaveAttribute('href', '/records/company')
  await page.getByRole('tab', { name: 'Timeline' }).click()
  await expect.poll(() => timelineRequests.length).toBeGreaterThan(0)
  expect(timelineRequests[0].searchParams.get('rootType')).toBe('company')
  expect(timelineRequests[0].searchParams.get('rootId')).toBe('company-1')

  await page.getByRole('combobox', { name: 'Activity type' }).click()
  await page.getByRole('option', { name: 'Tasks' }).click()
  await page.getByRole('combobox', { name: 'Contact' }).click()
  await page.getByRole('option', { name: 'Ada Lovelace' }).click()
  await page.getByRole('combobox', { name: 'Deal' }).click()
  await page.getByRole('option', { name: 'Enterprise renewal' }).click()
  await expect.poll(() => timelineRequests.some((url) =>
    url.searchParams.get('sourceType') === 'task' &&
    url.searchParams.get('personId') === 'person-1' &&
    url.searchParams.get('dealId') === 'deal-1',
  )).toBe(true)

  await page.getByRole('button', { name: 'Pan the timeline backward' }).click()
  await expect.poll(() => timelineRequests.some((url) => url.searchParams.has('occurredFrom'))).toBe(true)
  const requestCountBeforeZoom = timelineRequests.length
  await page.getByRole('button', { name: 'Zoom into the timeline' }).click()
  await expect.poll(() => timelineRequests.length).toBeGreaterThan(requestCountBeforeZoom)

  await page.getByRole('feed', { name: 'Account activity' }).getByRole('button', { name: 'Prepare renewal brief' }).click()
  await expect(page.getByRole('dialog', { name: 'task' })).toBeVisible()
  await page.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('tab', { name: 'Details' }).click()
  await page.getByRole('tab', { name: 'Timeline' }).click()
  await expect(page.getByRole('combobox', { name: 'Activity type' })).toContainText('Tasks')

  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 320, height: 740 }]) {
    await page.setViewportSize(viewport)
    await expect(page.getByRole('region', { name: 'Account momentum' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
  }
  expect(consoleErrors).toEqual([])
})

test('reaches the scoped Deal timeline without Company-only filters', async ({ page }) => {
  const { timelineRequests, consoleErrors } = await mockRecordPage(page)
  await page.goto('/__fixtures/records/deal/deal-1')
  await page.getByRole('tab', { name: 'Timeline' }).click()

  await expect.poll(() => timelineRequests.length).toBeGreaterThan(0)
  expect(timelineRequests[0].searchParams.get('rootType')).toBe('deal')
  expect(timelineRequests[0].searchParams.get('rootId')).toBe('deal-1')
  await expect(page.getByRole('region', { name: 'Account momentum' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Contact' })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Deal' })).toHaveCount(0)
  expect(consoleErrors).toEqual([])
})
