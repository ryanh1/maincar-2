import { expect, test } from '@playwright/test'

test('creates, edits, selects, defaults, and deletes a signature in Chromium', async ({ page }) => {
  const consoleErrors: string[] = []
  const signatures: Array<Record<string, unknown>> = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.route('**/api/email/orgs/org-fixture/signatures**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const signatureId = url.pathname.split('/').at(-1)
    if (request.method() === 'GET') return route.fulfill({ json: { signatures, total: signatures.length } })

    const body = request.postDataJSON() as Record<string, unknown> | null
    if (request.method() === 'POST') {
      const signature = {
        id: `sig-${signatures.length + 1}`,
        name: String(body?.name ?? ''),
        bodyHtml: String(body?.bodyHtml ?? ''),
        isDefault: false,
        isDefaultForNew: false,
        isDefaultForReply: false,
        createdAt: '2026-08-22T12:00:00.000Z',
        updatedAt: '2026-08-22T12:00:00.000Z',
      }
      signatures.push(signature)
      return route.fulfill({ status: 201, json: { signature } })
    }
    if (request.method() === 'PATCH') {
      const signature = signatures.find((entry) => entry.id === signatureId)
      if (!signature) return route.fulfill({ status: 404, json: { error: 'Signature not found' } })
      Object.assign(signature, body)
      if (body?.isDefaultForNew === true) {
        signatures.forEach((entry) => { if (entry.id !== signatureId) { entry.isDefault = false; entry.isDefaultForNew = false } })
        signature.isDefault = true
      }
      if (body?.isDefaultForReply === true) signatures.forEach((entry) => { if (entry.id !== signatureId) entry.isDefaultForReply = false })
      return route.fulfill({ json: { signature } })
    }
    if (request.method() === 'DELETE') {
      const index = signatures.findIndex((entry) => entry.id === signatureId)
      if (index === -1) return route.fulfill({ status: 404, json: { error: 'Signature not found' } })
      signatures.splice(index, 1)
      return route.fulfill({ json: { signature: { id: signatureId } } })
    }
    return route.fallback()
  })

  await page.goto('/__fixtures/email-signatures')
  await expect(page.getByRole('heading', { name: 'Signatures' })).toBeVisible()
  await page.getByRole('button', { name: 'New signature' }).click()
  await page.getByLabel(/^Name/).fill('Personal')
  await page.getByRole('textbox', { name: 'Signature' }).fill('Ari Rep')
  await page.getByRole('button', { name: 'Save signature' }).click()
  await expect(page.getByRole('option', { name: /Personal/ })).toBeVisible()

  await page.getByRole('combobox', { name: 'Default signature for new messages' }).click()
  await page.getByRole('option', { name: 'Personal' }).click()
  await page.getByRole('combobox', { name: 'Default signature for replies and forwards' }).click()
  await page.getByRole('option', { name: 'Personal' }).click()

  await page.reload()
  await expect(page.getByRole('option', { name: /Personal/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('combobox', { name: 'Default signature for new messages' })).toHaveText('Personal')
  await expect(page.getByRole('combobox', { name: 'Default signature for replies and forwards' })).toHaveText('Personal')

  await page.getByLabel(/^Name/).fill('Personal sign-off')
  await page.getByRole('button', { name: 'Save signature' }).click()
  await expect(page.getByRole('option', { name: /Personal sign-off/ })).toBeVisible()

  await page.getByRole('button', { name: 'Delete Personal sign-off' }).click()
  await expect(page.getByText('Emails already written with this signature stay as they are.')).toBeVisible()
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('option', { name: /Personal/ })).toHaveCount(0)
  expect(consoleErrors).toEqual([])
})
