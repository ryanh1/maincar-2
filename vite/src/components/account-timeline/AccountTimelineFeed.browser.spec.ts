import { expect, test } from '@playwright/test'

const EVENT = {
  id: 'event-fixture', sourceType: 'call', sourceId: 'call-fixture', title: 'Called Ada Lovelace',
  preview: 'Discussed the renewal plan.', subtype: null, intensity: 3,
  display: { actorName: 'Grace Hopper', personName: 'Ada Lovelace', dealName: 'Enterprise renewal' },
  marker: null, direction: 'outbound', occurredAt: '2026-08-22T18:00:00.000Z',
  companyId: 'company-fixture', personId: 'person-fixture', dealId: 'deal-fixture',
}

const STAGE_EVENT = {
  ...EVENT,
  id: 'stage-fixture',
  sourceType: 'stage_change',
  sourceId: 'stage-fixture',
  title: 'Moved to Proposal',
  preview: null,
  subtype: 'stage_changed',
  intensity: 1,
  marker: { type: 'stage_moved', before: 'Discovery', after: 'Proposal' },
  direction: null,
  occurredAt: '2026-08-22T20:00:00.000Z',
}

test('changes the one shared timeline query when an activity filter changes', async ({ page }) => {
  const timelineRequests: string[] = []
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.route('**/api/orgs/org-fixture/account-timeline**', async (route) => {
    timelineRequests.push(route.request().url())
    if (route.request().url().includes('/event-fixture?')) {
      await route.fulfill({ json: {
        event: EVENT,
        detail: { type: 'call', id: 'call-fixture', transcript: 'Discussed the renewal plan.', openFullCallPath: '/calls/call-fixture' },
        navigation: { previousEventId: null, nextEventId: null },
      } })
      return
    }
    await route.fulfill({ json: { events: [EVENT, STAGE_EVENT], nextCursor: null, range: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', isDefault: true } } })
  })

  await page.goto('/__fixtures/account-timeline')
  await expect(page.getByText('Called Ada Lovelace')).toBeVisible()
  expect(timelineRequests).toHaveLength(1)

  await page.getByRole('combobox', { name: 'Activity type' }).click()
  await page.getByRole('option', { name: 'Calls' }).click()
  await expect.poll(() => timelineRequests).toHaveLength(2)
  expect(timelineRequests[1]).toContain('sourceType=call')
  expect(consoleErrors).toEqual([])
})

test('narrows the shared feed to mine and keeps that selection while loading another page', async ({ page }) => {
  const timelineRequests: string[] = []
  const olderEvent = { ...EVENT, id: 'event-older', title: 'Created follow-up task', occurredAt: '2026-08-21T18:00:00.000Z' }
  await page.route('**/api/orgs/org-fixture/account-timeline**', async (route) => {
    const url = route.request().url()
    timelineRequests.push(url)
    const query = new URL(url).searchParams
    await route.fulfill({ json: {
      events: query.get('cursor') ? [olderEvent] : [EVENT],
      nextCursor: query.get('mine') === 'true' && !query.get('cursor') ? 'mine-cursor' : null,
      range: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', isDefault: true },
    } })
  })

  await page.goto('/__fixtures/account-timeline')
  await expect(page.getByText('Grace Hopper')).toBeVisible()
  await page.getByRole('button', { name: 'Mine' }).click()
  await expect.poll(() => timelineRequests.filter((url) => new URL(url).searchParams.get('mine') === 'true')).toHaveLength(1)
  await expect(page.getByRole('button', { name: 'Mine' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'Load more' }).click()
  await expect.poll(() => timelineRequests.filter((url) => new URL(url).searchParams.get('cursor') === 'mine-cursor')).toHaveLength(1)
  const nextPageRequest = timelineRequests.find((url) => new URL(url).searchParams.get('cursor') === 'mine-cursor')!
  expect(new URL(nextPageRequest).searchParams.get('mine')).toBe('true')
  await expect(page.getByText('Created follow-up task')).toBeVisible()
})

test('opens the selected event in the right-side detail panel without leaving the filtered timeline', async ({ page }) => {
  await page.route('**/api/orgs/org-fixture/account-timeline**', async (route) => {
    if (route.request().url().includes('/event-fixture?')) {
      await route.fulfill({ json: {
        event: EVENT,
        detail: { type: 'call', id: 'call-fixture', transcript: 'Discussed the renewal plan.', openFullCallPath: '/calls/call-fixture' },
        navigation: { previousEventId: null, nextEventId: null },
      } })
      return
    }
    await route.fulfill({ json: { events: [EVENT, STAGE_EVENT], nextCursor: null, range: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', isDefault: true } } })
  })

  await page.goto('/__fixtures/account-timeline')
  await page.getByRole('button', { name: /Call: Called Ada Lovelace/ }).click()
  const panel = page.getByRole('dialog', { name: 'call' })
  await expect(panel.getByText('Discussed the renewal plan.')).toBeVisible()
  await expect(panel.getByRole('link', { name: 'Open full call' })).toHaveAttribute('href', '/calls/call-fixture')
})

test('reframes the band and feed together and keeps the timeline keyboard-readable in light and dark themes', async ({ page }) => {
  const listRequests: string[] = []
  await page.route('**/api/orgs/org-fixture/account-timeline**', async (route) => {
    if (route.request().url().includes('/stage-fixture?')) {
      await route.fulfill({ json: {
        event: STAGE_EVENT,
        detail: { type: 'stage_change', id: 'stage-fixture', marker: STAGE_EVENT.marker },
        navigation: { previousEventId: 'event-fixture', nextEventId: null },
      } })
      return
    }
    if (!route.request().url().includes('/event-fixture?')) listRequests.push(route.request().url())
    await route.fulfill({ json: { events: [EVENT, STAGE_EVENT], nextCursor: null, range: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', isDefault: listRequests.length === 1 } } })
  })

  await page.goto('/__fixtures/account-timeline')
  const band = page.getByRole('region', { name: 'Account momentum' })
  await expect(band).toBeVisible()
  await expect(page.getByRole('button', { name: 'Deal stage moved from Discovery to Proposal' })).toBeVisible()
  await expect(page.getByLabel('Future timeline region')).toBeVisible()

  await page.getByRole('button', { name: 'Month' }).click()
  await expect.poll(() => listRequests.length).toBe(2)
  const selectedRange = new URL(listRequests[1]).searchParams
  expect(selectedRange.get('occurredFrom')).not.toBeNull()
  expect(selectedRange.get('occurredTo')).not.toBeNull()

  const callBubble = page.getByRole('button', { name: /Call: Called Ada Lovelace/ })
  await callBubble.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('button', { name: /Stage change: Moved to Proposal/ })).toBeFocused()

  const lightBackground = await band.evaluate((element) => getComputedStyle(element).backgroundColor)
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  const darkBackground = await band.evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(darkBackground).not.toBe(lightBackground)
  await expect(page.getByRole('button', { name: 'Deal stage moved from Discovery to Proposal' })).toBeVisible()
})

test('keeps timeline shortcuts scoped, restores focus, and avoids overflow across widths and themes', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.route('**/api/orgs/org-fixture/calls/call-fixture', async (route) => {
    await route.fulfill({ json: { call: { toE164: '+15555550100', review: null } } })
  })
  await page.route('**/api/orgs/org-fixture/account-timeline**', async (route) => {
    const url = route.request().url()
    if (url.includes('/event-fixture?')) {
      await route.fulfill({ json: {
        event: EVENT,
        detail: { type: 'call', id: 'call-fixture', transcript: 'Discussed the renewal plan.' },
        navigation: { previousEventId: null, nextEventId: 'stage-fixture' },
      } })
      return
    }
    if (url.includes('/stage-fixture?')) {
      await route.fulfill({ json: {
        event: STAGE_EVENT,
        detail: { type: 'stage_change', id: 'stage-fixture', marker: STAGE_EVENT.marker },
        navigation: { previousEventId: 'event-fixture', nextEventId: null },
      } })
      return
    }
    await route.fulfill({ json: {
      events: [EVENT, STAGE_EVENT],
      nextCursor: null,
      range: { from: '2026-08-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z', isDefault: true },
    } })
  })

  for (const width of [320, 768, 1024]) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/__fixtures/account-timeline')
      await page.evaluate((nextTheme) => {
        document.documentElement.classList.toggle('dark', nextTheme === 'dark')
      }, theme)

      const feed = page.getByRole('feed', { name: 'Account activity' })
      const firstEvent = feed.getByRole('button', { name: 'Called Ada Lovelace', exact: true })
      const secondEvent = feed.getByRole('button', { name: 'Moved to Proposal', exact: true })
      await feed.focus()
      await page.keyboard.press('j')
      await expect(firstEvent).toBeFocused()
      await page.keyboard.press('j')
      await expect(secondEvent).toBeFocused()
      await page.keyboard.press('k')
      await expect(firstEvent).toBeFocused()

      await page.keyboard.press('Enter')
      const panel = page.getByRole('dialog', { name: 'call' })
      await expect(panel).toBeVisible()
      const panelOverflow = await panel.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }))
      expect(panelOverflow.scrollWidth, `${theme} panel at ${width}px`).toBeLessThanOrEqual(panelOverflow.clientWidth)
      await page.keyboard.press('ArrowRight')
      await expect(page.getByRole('dialog', { name: 'stage change' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(firstEvent).toBeFocused()

      const overflow = await page.locator('html').evaluate((root) => ({
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
      }))
      expect(overflow.scrollWidth, `${theme} theme at ${width}px`).toBeLessThanOrEqual(overflow.clientWidth)
    }
  }
  expect(consoleErrors).toEqual([])
})
