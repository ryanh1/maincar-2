import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { SIDEBAR_WIDTH_PX } from './sidebarWidth'

/**
 * `SIDEBAR_WIDTH_PX` is a number agreed with two Tailwind classes it cannot
 * import, the same shape as the composer dock's dialer reserve. Nothing in the
 * type system ties them together, so these read the source and fail the moment
 * the sidebar is resized without the number following it.
 */
function read(file: string): string {
  return readFileSync(path.join(import.meta.dirname, file), 'utf8')
}

// Tailwind's spacing scale is 4 px a step, so `w-56` is 224 px.
const STEP_PX = 4

describe('SIDEBAR_WIDTH_PX', () => {
  it('matches the width Sidebar.tsx actually renders', () => {
    const aside = /fixed inset-y-0 left-0[^'"]*/.exec(read('Sidebar.tsx'))?.[0]
    const step = /\bw-(\d+)\b/.exec(aside ?? '')?.[1]

    expect(step).toBeDefined()
    expect(Number(step) * STEP_PX).toBe(SIDEBAR_WIDTH_PX)
  })

  it('matches the offset ProtectedLayout.tsx indents the page by', () => {
    const step = /\blg:ml-(\d+)\b/.exec(read('ProtectedLayout.tsx'))?.[1]

    expect(step).toBeDefined()
    expect(Number(step) * STEP_PX).toBe(SIDEBAR_WIDTH_PX)
  })
})
