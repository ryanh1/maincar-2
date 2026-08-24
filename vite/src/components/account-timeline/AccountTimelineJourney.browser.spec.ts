import { expect, test, type Page } from '@playwright/test'

import type { AccountTimelineEvent, AccountTimelineSourceType } from '../../lib/accountTimelineTypes'

const SHIPPED_SOURCE_TYPES = [
  'call',
  'email',
  'sms',
  'meeting',
  'note',
  'stage_change',
  'task',
  'record_created',
  'custom',
] as const satisfies readonly AccountTimelineSourceType[]

const SOURCE_LABELS: Record<AccountTimelineSourceType, string> = {
  call: 'Call',
  email: 'Email',
  sms: 'Text',
  meeting: 'Meeting',
  note: 'Note',
  stage_change: 'Stage change',
  task: 'Task',
  record_created: 'Record created',
  custom: 'Activity',
}

const EVENTS: AccountTimelineEvent[] = SHIPPED_SOURCE_TYPES.map((sourceType, index) => ({
  id: `event-${sourceType}`,
  sourceType,
  sourceId: `source-${sourceType}`,
  title: `Timeline ${sourceType.replace('_', ' ')}`,
  preview: `Reconciled ${sourceType} projection.`,
  subtype: sourceType === 'stage_change' ? 'stage_changed' : null,
  intensity: sourceType === 'stage_change' ? 1 : 2,
  display: {
    actorName: 'Fixture Rep',
    personName: 'Ada Lovelace',
    dealName: 'Enterprise renewal',
  },
  marker: sourceType === 'stage_change'
    ? { type: 'stage_moved', before: 'Discovery', after: 'Proposal' }
    : null,
  direction: sourceType === 'sms'
    ? 'inbound'
    : ['call', 'email', 'meeting'].includes(sourceType)
      ? 'outbound'
      : null,
  occurredAt: new Date(Date.UTC(2026, 7, 20, 9, index)).toISOString(),
  companyId: 'company-fixture',
  personId: 'person-fixture',
  dealId: 'deal-fixture',
}))

async function mockIntegratedTimeline(page: Page) {
  const listRequests: URL[] = []
  const detailRequests: URL[] = []
  const consoleErrors: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.route('**/api/orgs/org-fixture/account-timeline**', async (route) => {
    const url = new URL(route.request().url())
    const eventId = url.pathname.split('/').at(-1)
    const eventIndex = EVENTS.findIndex((event) => event.id === eventId)

    if (eventIndex >= 0) {
      const event = EVENTS[eventIndex]
      detailRequests.push(url)
      await route.fulfill({
        json: {
          event,
          detail: {
            type: event.sourceType,
            id: event.sourceId,
            title: event.title,
            body: `Detail for ${event.sourceType}.`,
          },
          navigation: {
            previousEventId: EVENTS[eventIndex - 1]?.id ?? null,
            nextEventId: EVENTS[eventIndex + 1]?.id ?? null,
          },
        },
      })
      return
    }

    listRequests.push(url)
    const sourceType = url.searchParams.get('sourceType')
    const events = sourceType
      ? EVENTS.filter((event) => event.sourceType === sourceType)
      : EVENTS
    await route.fulfill({
      json: {
        events,
        nextCursor: null,
        range: {
          from: url.searchParams.get('occurredFrom') ?? '2026-08-01T00:00:00.000Z',
          to: url.searchParams.get('occurredTo') ?? '2026-09-01T00:00:00.000Z',
          isDefault: !url.searchParams.has('occurredFrom'),
        },
      },
    })
  })

  return { consoleErrors, detailRequests, listRequests }
}

test('reconciles the complete account timeline through the full responsive journey', async ({ page }) => {
  expect(new Set(SHIPPED_SOURCE_TYPES).size).toBe(SHIPPED_SOURCE_TYPES.length)
  expect(new Set(EVENTS.map((event) => `${event.sourceType}:${event.sourceId}`)).size).toBe(EVENTS.length)

  const { consoleErrors, detailRequests, listRequests } = await mockIntegratedTimeline(page)
  await page.addInitScript(() => window.sessionStorage.clear())

  for (const viewport of [{ width: 320, height: 740 }, { width: 768, height: 900 }, { width: 1024, height: 900 }]) {
    for (const theme of ['light', 'dark']) {
      const initialListCount = listRequests.length
      const initialDetailCount = detailRequests.length
      await page.setViewportSize(viewport)
      await page.goto('/__fixtures/account-timeline')
      await page.evaluate((selectedTheme) => {
        document.documentElement.classList.toggle('dark', selectedTheme === 'dark')
      }, theme)

      const feedRows = page.getByRole('feed', { name: 'Account activity' }).locator('[data-event-id]')
      const bubbles = page.locator('[data-timeline-bubble]')
      await expect.poll(() => listRequests.length).toBe(initialListCount + 1)
      expect(listRequests.at(-1)?.searchParams.has('occurredFrom')).toBe(false)
      await expect(page.getByRole('button', { name: 'Reset to default' })).toHaveCount(0)
      await expect(feedRows).toHaveCount(EVENTS.length)
      await expect(bubbles).toHaveCount(EVENTS.length)

      for (const event of EVENTS) {
        await expect(page.getByRole('button', { name: event.title, exact: true })).toHaveCount(1)
        await expect(page.getByRole('button', {
          name: new RegExp(`^${SOURCE_LABELS[event.sourceType]}: ${event.title},`),
        })).toHaveCount(1)
      }

      await page.getByRole('combobox', { name: 'Activity type' }).click()
      await page.getByRole('option', { name: 'Calls' }).click()
      await expect.poll(() => listRequests.length).toBe(initialListCount + 2)
      expect(listRequests.at(-1)?.searchParams.get('sourceType')).toBe('call')
      await expect(feedRows).toHaveCount(1)
      await expect(bubbles).toHaveCount(1)

      await page.getByRole('combobox', { name: 'Activity type' }).click()
      await page.getByRole('option', { name: 'All activity' }).click()
      await expect.poll(() => listRequests.length).toBe(initialListCount + 3)
      await expect(feedRows).toHaveCount(EVENTS.length)
      await expect(bubbles).toHaveCount(EVENTS.length)

      await page.getByRole('button', { name: 'Pan the timeline backward' }).click()
      await expect.poll(() => listRequests.length).toBe(initialListCount + 4)
      expect(listRequests.at(-1)?.searchParams.has('occurredFrom')).toBe(true)
      await expect(page.getByRole('button', { name: 'Reset to default' })).toBeVisible()

      await page.getByRole('button', { name: 'Zoom into the timeline' }).click()
      await expect.poll(() => listRequests.length).toBe(initialListCount + 5)
      expect(listRequests.at(-1)?.searchParams.has('occurredTo')).toBe(true)

      await page.getByRole('button', { name: 'Reset to default' }).click()
      await expect.poll(() => listRequests.length).toBe(initialListCount + 6)
      expect(listRequests.at(-1)?.searchParams.has('occurredFrom')).toBe(false)
      await expect(page.getByRole('button', { name: 'Reset to default' })).toHaveCount(0)

      await page.getByRole('button', { name: 'Timeline note', exact: true }).click()
      await expect.poll(() => detailRequests.length).toBe(initialDetailCount + 1)
      await expect(page.getByRole('dialog', { name: 'note' })).toBeVisible()
      await page.getByRole('button', { name: 'Show the next timeline event' }).click()
      await expect.poll(() => detailRequests.length).toBe(initialDetailCount + 2)
      await expect(page.getByRole('dialog', { name: 'stage change' })).toBeVisible()
      await page.getByRole('button', { name: 'Close' }).click()

      expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark')
      const overflow = await page.locator('html').evaluate((root) => ({
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
      }))
      expect(overflow.scrollWidth, `${theme} theme at ${viewport.width}px`).toBeLessThanOrEqual(overflow.clientWidth)
      expect(listRequests.length - initialListCount, 'one list read per range or filter state').toBe(6)
      expect(detailRequests.length - initialDetailCount, 'one source read per opened detail').toBe(2)
    }
  }

  expect(consoleErrors).toEqual([])
})
