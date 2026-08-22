import { expect, test } from '@playwright/test'

const calls = [
  {
    id: 'call-eligible', direction: 'outbound', status: 'completed',
    fromE164: '+12015550100', toE164: '+12015550111', recordingPlanned: true,
    recordingReason: 'allowed', transcriptStatus: 'done', twilioCallSid: 'CAeligible',
    durationS: 73, startedAt: '2026-08-01T12:00:00.000Z', endedAt: '2026-08-01T12:01:13.000Z',
    createdAt: '2026-08-01T12:00:00.000Z',
  },
  {
    id: 'call-unavailable', direction: 'outbound', status: 'completed',
    fromE164: '+12015550100', toE164: '+12015550122', recordingPlanned: false,
    recordingReason: 'unknown-destination-state', transcriptStatus: 'skipped-not-recorded',
    twilioCallSid: 'CAunavailable', durationS: 23, startedAt: '2026-08-01T12:05:00.000Z',
    endedAt: '2026-08-01T12:05:23.000Z', createdAt: '2026-08-01T12:05:00.000Z',
  },
]

const detail = {
  ...calls[0], destinationState: 'DC', recordingEnabled: true,
  // The server upload worker owns media storage coverage. Keep this browser
  // fixture local and deterministic by exercising the transcript surface only.
  recordingUrl: null,
  transcript: 'Hello, this is the final Deepgram transcript.',
}

const unavailableDetail = {
  ...calls[1], destinationState: null, recordingEnabled: false, recordingUrl: null, transcript: null,
}

test('shows the final transcript for an eligible recording and an honest unavailable state for the other path', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.route('**/api/orgs/org-fixture/calls**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname.endsWith('/calls')) {
      return route.fulfill({ json: { calls, total: calls.length, page: 1, limit: 25 } })
    }
    if (pathname.endsWith('/calls/call-eligible')) return route.fulfill({ json: { call: detail } })
    return route.fulfill({ json: { call: unavailableDetail } })
  })
  await page.route('**/api/orgs/org-fixture/dispositions', (route) =>
    route.fulfill({ json: { dispositions: [] } }),
  )

  await page.goto('/__fixtures/call-transcript')
  await expect(page.getByText('Ready')).toBeVisible()
  await expect(page.getByText('None')).toBeVisible()

  await page.getByRole('link', { name: '+12015550111' }).click()
  await expect(page.getByText('Hello, this is the final Deepgram transcript.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy transcript' })).toBeVisible()

  await page.getByRole('link', { name: 'Back' }).click()
  await page.getByRole('link', { name: '+12015550122' }).click()
  await expect(page.getByText('This call was not recorded, so there is no transcript.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy transcript' })).toHaveCount(0)
  expect(consoleErrors).toEqual([])
})
