import { expect, test } from '@playwright/test'

type Disposition = {
  id: string
  value: string
  label: string
  color: `option-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  icon: string | null
  category: 'connected' | 'not_connected'
  isStandard: boolean
  isPinned: boolean
  pinOrder: number | null
  sortOrder: number
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

const now = '2026-08-23T00:00:00.000Z'
const dispositions: Disposition[] = [
  ['connected', 'Connected'], ['voicemail', 'Left voicemail'], ['no_answer', 'No answer'], ['busy', 'Busy'], ['wrong_number', 'Wrong number'], ['callback', 'Call back'],
].map(([value, label], index) => ({
  id: `disposition-${index + 1}`,
  value,
  label,
  color: `option-${index + 1}` as Disposition['color'],
  icon: null,
  category: 'not_connected',
  isStandard: true,
  isPinned: true,
  pinOrder: index,
  sortOrder: index,
  isArchived: false,
  createdAt: now,
  updatedAt: now,
}))

function barOrder() {
  return [...dispositions].sort((left, right) => Number(right.isPinned) - Number(left.isPinned) || (left.pinOrder ?? Infinity) - (right.pinOrder ?? Infinity) || left.sortOrder - right.sortOrder)
}

test('creates, pins, reorders, publishes, and reloads the disposition bar in Chromium', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.route('**/api/orgs/org-fixture/dispositions**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET') return route.fulfill({ json: { dispositions: barOrder() } })

    const body = request.postDataJSON() as Record<string, unknown>
    if (request.method() === 'POST') {
      const disposition: Disposition = {
        id: 'disposition-follow-up',
        value: String(body.value),
        label: String(body.label),
        color: body.color as Disposition['color'],
        icon: body.icon as string | null,
        category: body.category as Disposition['category'],
        isStandard: false,
        isPinned: false,
        pinOrder: null,
        sortOrder: dispositions.length,
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      }
      dispositions.push(disposition)
      return route.fulfill({ status: 201, json: { disposition } })
    }

    if (request.method() === 'PUT' && path.endsWith('/bar')) {
      const pinnedIds = body.pinnedIds as string[]
      dispositions.forEach((disposition) => {
        const pinOrder = pinnedIds.indexOf(disposition.id)
        disposition.isPinned = pinOrder >= 0
        disposition.pinOrder = pinOrder >= 0 ? pinOrder : null
      })
      return route.fulfill({ json: { dispositions: barOrder() } })
    }
    return route.fallback()
  })

  await page.goto('/__fixtures/dispositions')
  await expect(page.getByRole('heading', { name: 'Call dispositions' })).toBeVisible()
  await page.getByRole('button', { name: 'Add disposition' }).click()
  await page.getByLabel('Label').fill('Follow up')
  await page.getByLabel('Value').fill('follow_up')
  await page.getByRole('button', { name: 'Save disposition' }).click()

  await page.getByRole('button', { name: 'Pin Follow up' }).click()
  await page.getByRole('button', { name: 'Move Follow up left' }).click()
  await page.getByRole('button', { name: 'Move Follow up left' }).click()
  await page.getByRole('button', { name: 'Move Follow up left' }).click()
  await page.getByRole('button', { name: 'Move Follow up left' }).click()
  await page.getByRole('button', { name: 'Move Follow up left' }).click()
  await page.getByRole('button', { name: 'Move Follow up left' }).click()
  await page.getByRole('button', { name: 'Publish bar' }).click()
  await expect(page.getByText('Disposition bar published.')).toBeVisible()

  await page.reload()
  const preview = page.getByRole('group', { name: 'Disposition bar preview' })
  await expect(preview.locator(':scope > div').first()).toHaveText('Follow up')
  expect(consoleErrors).toEqual([])
})
