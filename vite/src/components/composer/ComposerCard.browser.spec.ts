import { expect, test } from '@playwright/test'

const modes = [
  { mode: 'new', signature: true, existingText: '' },
  { mode: 'reply', signature: false, existingText: 'Earlier reply context' },
  { mode: 'forward', signature: false, existingText: 'Forwarded message' },
] as const

async function stubComposerData(page: import('@playwright/test').Page) {
  await page.route('**/api/email/orgs/org-fixture/signatures', (route) =>
    route.fulfill({ json: {
      signatures: [
        { id: 'signature-default', name: 'Default', bodyHtml: '<p>Fixture signature</p>', isDefault: true, createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z' },
        { id: 'signature-alt', name: 'Alternate', bodyHtml: '<p>Alternate signature</p>', isDefault: false, createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z' },
      ],
      total: 2,
    } }),
  )
  const privateTemplates = [
    { id: 'template-private', name: 'My fixture template', subject: 'Fixture subject', bodyHtml: '<p>Fixture template body</p>', visibility: 'PRIVATE', createdById: 'user-fixture', fieldsJson: null, createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z' },
  ]
  const organizationTemplates = [
    { id: 'template-organization-a', name: 'Organization fixture template', subject: 'Organization fixture subject', bodyHtml: '<p>Organization fixture body</p>', visibility: 'ORGANIZATION', createdById: 'user-fixture', fieldsJson: null, createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z' },
    { id: 'template-organization-b', name: 'Organization follow-up', subject: 'Organization follow-up subject', bodyHtml: '<p>Organization follow-up body</p>', visibility: 'ORGANIZATION', createdById: 'user-fixture', fieldsJson: null, createdAt: '2026-08-22T12:00:00.000Z', updatedAt: '2026-08-22T12:00:00.000Z' },
  ]
  await page.route('**/api/email/orgs/org-fixture/templates**', (route) => {
    const scope = new URL(route.request().url()).searchParams.get('scope')
    const templates = scope === 'private'
      ? privateTemplates
      : scope === 'organization'
        ? organizationTemplates
        : [...privateTemplates, ...organizationTemplates]
    return route.fulfill({ json: { templates, total: templates.length, page: 1, limit: 100 } })
  })
  await page.route('**/api/mailboxes/orgs/org-fixture', (route) => route.fulfill({ json: { mailboxes: [], total: 0 } }))
}

for (const scenario of modes) {
  test(`${scenario.mode} composer tabs from recipients to subject and starts writing at the body beginning`, async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await stubComposerData(page)
    await page.goto(`/__fixtures/composer-focus?mode=${scenario.mode}`)

    const to = page.getByRole('textbox', { name: 'To', exact: true })
    const subject = page.getByLabel('Subject')
    const message = page.getByRole('textbox', { name: 'Message' })
    if (scenario.signature) await expect(message).toContainText('Fixture signature')

    await expect(to).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Cc', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Bcc', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(subject).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(message).toBeFocused()

    await page.keyboard.type('Hello ')
    await expect(message).toContainText(`Hello ${scenario.signature ? 'Fixture signature' : scenario.existingText}`)
    expect(consoleErrors).toEqual([])
  })
}

test('recipient, template, and signature updates do not reset composer focus', async ({ page }) => {
  await stubComposerData(page)
  await page.goto('/__fixtures/composer-focus?mode=new')

  const to = page.getByRole('textbox', { name: 'To', exact: true })
  const message = page.getByRole('textbox', { name: 'Message' })
  const actionsButton = page.getByRole('button', { name: 'Show email actions' })
  const signatureButton = page.getByRole('button', { name: 'Choose a signature for this email' })

  await to.fill('casey@example.com')
  await page.keyboard.press('Enter')
  await expect(to).toBeFocused()

  await actionsButton.click()
  await page.getByRole('menuitem', { name: 'Templates' }).hover()
  await page.getByRole('menuitem', { name: 'My fixture template' }).click()
  await page.getByRole('button', { name: 'Replace' }).click()
  await expect(message).toBeFocused()

  await signatureButton.click()
  await page.getByRole('menuitem', { name: 'Alternate' }).click()
  await expect(message).toBeFocused()
})

for (const { name, viewport } of [
  { name: 'desktop', viewport: { width: 1024, height: 768 } },
  { name: 'narrow', viewport: { width: 390, height: 844 } },
]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${name} ${theme} theme keeps organization templates in a secondary picker`, async ({ page }) => {
      const consoleErrors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text())
      })
      await page.setViewportSize(viewport)
      await stubComposerData(page)
      await page.goto(`/__fixtures/composer-focus?mode=new&theme=${theme}`)

      const to = page.getByRole('textbox', { name: 'To', exact: true })
      await to.fill('casey@example.com')
      await page.keyboard.press('Enter')

      await page.getByRole('button', { name: 'Show email actions' }).click()
      await page.getByRole('menuitem', { name: 'Templates' }).hover()
      await expect(page.getByRole('menuitem', { name: 'My fixture template' })).toBeVisible()

      const organizationTrigger = page.getByRole('menuitem', { name: 'Organization templates · 2' })
      await organizationTrigger.hover()
      const organizationTemplate = page.getByRole('menuitem', { name: 'Organization fixture template' })
      await expect(organizationTemplate).toBeVisible()
      const bounds = await organizationTemplate.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
      await organizationTemplate.click()
      await page.getByRole('button', { name: 'Replace' }).click()

      await expect(page.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('Organization fixture subject')
      await expect(page.getByRole('textbox', { name: 'Message' })).toContainText('Organization fixture body')
      await expect(page.getByText('casey@example.com', { exact: true })).toBeVisible()
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /^(?!.*dark).*$/)
      expect(consoleErrors).toEqual([])
    })
  }
}
