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
  {
    id: 'call-no-speech', direction: 'outbound', status: 'completed',
    fromE164: '+12015550100', toE164: '+12015550133', recordingPlanned: true,
    recordingReason: 'allowed', transcriptStatus: 'done', twilioCallSid: 'CAnospeech',
    durationS: 9, startedAt: '2026-08-01T12:10:00.000Z', endedAt: '2026-08-01T12:10:09.000Z',
    createdAt: '2026-08-01T12:10:00.000Z',
  },
]

const detail = {
  ...calls[0], destinationState: 'DC', recordingEnabled: true,
  recordingUrl: '/__fixtures/call-review.wav',
  transcript: 'Hello there. The renewal works.',
  review: {
    crm: { person: null, company: null, deal: null },
    recording: { state: 'ready', source: { kind: 'audio', url: '/__fixtures/call-review.wav', expiresAt: '2026-08-24T01:00:00.000Z' } },
    transcript: { state: 'ready', pass: { id: 'pass-fixture', provider: 'fixture', plainText: 'Hello there. The renewal works.', segments: [
      { id: 'segment-1', position: 0, speakerKey: 'rep', startMs: 0, endMs: 1_200, text: 'Hello there.', words: [
        { word: 'Hello', punctuatedWord: 'Hello', startMs: 0, endMs: 400 },
        { word: 'there', punctuatedWord: 'there.', startMs: 500, endMs: 1_000 },
      ] },
      { id: 'segment-2', position: 1, speakerKey: 'buyer', startMs: 1_400, endMs: 2_700, text: 'The renewal works.', words: [
        { word: 'The', punctuatedWord: 'The', startMs: 1_400, endMs: 1_600 },
        { word: 'renewal', punctuatedWord: 'renewal', startMs: 1_650, endMs: 2_000 },
        { word: 'works', punctuatedWord: 'works.', startMs: 2_050, endMs: 2_500 },
      ] },
    ] } },
    speakers: [
      { id: 'speaker-1', speakerKey: 'rep', displayName: 'Fixture Rep', source: 'call-user', confidence: 1, confirmedAt: null, manualOverride: false, person: null },
      { id: 'speaker-2', speakerKey: 'buyer', displayName: 'Morgan Lee', source: 'manual', confidence: 1, confirmedAt: null, manualOverride: true, person: null },
    ],
  },
}

const unavailableDetail = {
  ...calls[1], destinationState: null, recordingEnabled: false, recordingUrl: null, transcript: null,
}

const noSpeechDetail = {
  ...calls[2], destinationState: 'DC', recordingEnabled: true, recordingUrl: null, transcript: '',
}

function silentWavDataUrl(seconds: number): string {
  const sampleRate = 8_000
  const dataLength = sampleRate * seconds * 2
  const bytes = new Uint8Array(44 + dataLength)
  const view = new DataView(bytes.buffer)
  const writeText = (offset: number, value: string) => value.split('').forEach((character, index) => {
    bytes[offset + index] = character.charCodeAt(0)
  })
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeText(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, dataLength, true)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768))
  }
  return `data:audio/wav;base64,${btoa(binary)}`
}

test('shows the final transcript for an eligible recording and an honest unavailable state for the other path', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  const audioUrl = silentWavDataUrl(4)
  const timedDetail = {
    ...detail,
    recordingUrl: audioUrl,
    review: { ...detail.review, recording: { ...detail.review.recording, source: { ...detail.review.recording.source, url: audioUrl } } },
  }

  await page.route('**/api/orgs/org-fixture/calls**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname.endsWith('/calls')) {
      return route.fulfill({ json: { calls, total: calls.length, page: 1, limit: 25 } })
    }
    if (pathname.endsWith('/calls/call-eligible')) return route.fulfill({ json: { call: timedDetail } })
    if (pathname.endsWith('/calls/call-no-speech')) return route.fulfill({ json: { call: noSpeechDetail } })
    return route.fulfill({ json: { call: unavailableDetail } })
  })
  await page.route('**/api/orgs/org-fixture/dispositions', (route) =>
    route.fulfill({ json: { dispositions: [] } }),
  )

  await page.goto('/__fixtures/call-transcript')
  await expect(page.getByRole('cell', { name: 'Ready' })).toHaveCount(2)
  await expect(page.getByText('None')).toBeVisible()

  await page.getByRole('link', { name: '+12015550111' }).click()
  await expect(page.getByRole('region', { name: 'Timed transcript' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hello, 00:00' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy transcript' })).toBeVisible()

  const renewalWord = page.getByRole('button', { name: 'renewal, 00:01' })
  await renewalWord.scrollIntoViewIfNeeded()
  await renewalWord.click()
  await expect.poll(() => page.locator('audio').evaluate((audio) => (audio as HTMLAudioElement).currentTime)).toBeCloseTo(1.65, 2)

  await page.getByRole('searchbox', { name: 'Search transcript' }).fill('renewal')
  await expect(page.getByText('1 of 1')).toBeVisible()
  await expect(page.getByTestId('speaker-ribbon-marker-transcript-search-0')).toBeVisible()

  await page.getByRole('region', { name: 'Timed transcript' }).hover()
  await page.mouse.wheel(0, 200)
  await expect(page.getByRole('button', { name: 'Jump to current' })).toBeVisible()
  await page.getByRole('button', { name: 'Jump to current' }).click()
  await expect(page.getByRole('button', { name: 'Jump to current' })).toHaveCount(0)

  await page.getByRole('link', { name: 'Back' }).click()
  await page.getByRole('link', { name: '+12015550122' }).click()
  await expect(page.getByText('This call was not recorded, so there is no transcript.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy transcript' })).toHaveCount(0)

  await page.getByRole('link', { name: 'Back' }).click()
  await page.getByRole('link', { name: '+12015550133' }).click()
  await expect(page.getByText('No speech was transcribed.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copy transcript' })).toHaveCount(0)
  expect(consoleErrors).toEqual([])
})
