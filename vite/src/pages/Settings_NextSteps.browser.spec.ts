import { expect, test } from '@playwright/test'

type NextStepType = {
  id: string; value: string; label: string; color: `option-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`; icon: string | null
  isPinned: boolean; pinOrder: number | null; sortOrder: number; isOverflow: boolean; requiresDateTime: boolean; createsTask: boolean; isArchived: boolean; createdAt: string; updatedAt: string
}

const now = '2026-08-23T00:00:00.000Z'
const types: NextStepType[] = []
const rules = new Map<string, string>()
const dispositions = [{ id: 'disposition-no-answer', value: 'no_answer', label: 'No answer', color: 'option-1', icon: null, category: 'not_connected', isStandard: true, isPinned: false, pinOrder: null, sortOrder: 0, isArchived: false, createdAt: now, updatedAt: now }]

function orderedTypes() {
  return [...types].sort((left, right) => Number(right.isPinned) - Number(left.isPinned) || (left.pinOrder ?? Infinity) - (right.pinOrder ?? Infinity) || left.sortOrder - right.sortOrder)
}

test('configures Callback and a No answer suggestion that persist after reload', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  types.splice(0)
  rules.clear()

  await page.route('**/api/orgs/org-fixture/dispositions', (route) => route.fulfill({ json: { dispositions } }))
  await page.route('**/api/orgs/org-fixture/next-steps/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET' && path.endsWith('/types')) return route.fulfill({ json: { types: orderedTypes() } })
    if (request.method() === 'GET' && path.endsWith('/rules')) return route.fulfill({ json: { rules: [...rules].map(([dispositionId, nextStepTypeId]) => ({ dispositionId, nextStepType: types.find((type) => type.id === nextStepTypeId) })) } })

    const body = request.postDataJSON() as Record<string, unknown>
    if (request.method() === 'POST' && path.endsWith('/types')) {
      const type: NextStepType = { id: 'next-step-callback', value: String(body.value), label: String(body.label), color: body.color as NextStepType['color'], icon: body.icon as string | null, isPinned: false, pinOrder: null, sortOrder: types.length, isOverflow: Boolean(body.isOverflow), requiresDateTime: Boolean(body.requiresDateTime), createsTask: Boolean(body.createsTask), isArchived: false, createdAt: now, updatedAt: now }
      types.push(type)
      return route.fulfill({ status: 201, json: { type } })
    }
    if (request.method() === 'PUT' && path.endsWith('/types/bar')) {
      const pinnedIds = body.pinnedIds as string[]
      types.forEach((type) => { const pinOrder = pinnedIds.indexOf(type.id); type.isPinned = pinOrder >= 0; type.pinOrder = pinOrder >= 0 ? pinOrder : null })
      return route.fulfill({ json: { types: orderedTypes() } })
    }
    if (request.method() === 'PUT' && path.includes('/rules/')) {
      const dispositionId = path.split('/').at(-1)!
      const nextStepTypeId = body.nextStepTypeId as string | null
      if (nextStepTypeId) rules.set(dispositionId, nextStepTypeId)
      else rules.delete(dispositionId)
      return route.fulfill({ json: { rule: nextStepTypeId ? { dispositionId, nextStepTypeId } : null } })
    }
    return route.fallback()
  })

  await page.goto('/__fixtures/next-steps')
  await expect(page.getByRole('heading', { name: 'Next steps' })).toBeVisible()
  await page.getByRole('button', { name: 'Add next step' }).click()
  await page.getByLabel('Label').fill('Callback')
  await page.getByLabel('Value').fill('callback')
  await page.getByRole('switch', { name: 'Require a date and time' }).click()
  await page.getByRole('button', { name: 'Save next step' }).click()
  await page.getByRole('button', { name: 'Pin Callback' }).click()
  await page.getByRole('button', { name: 'Publish next-step row' }).click()
  await expect(page.getByText('Next-step row published.')).toBeVisible()
  await page.getByRole('combobox', { name: 'Suggested next step for No answer' }).click()
  await page.getByRole('option', { name: 'Callback' }).click()
  await expect(page.getByText('Suggestion saved.')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('group', { name: 'Next-step row preview' })).toHaveText('Callback')
  await expect(page.getByRole('combobox', { name: 'Suggested next step for No answer' })).toHaveText('Callback')
  expect(consoleErrors).toEqual([])
})
