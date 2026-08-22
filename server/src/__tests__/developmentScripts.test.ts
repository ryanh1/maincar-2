import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const packageJsonUrl = new URL('../../package.json', import.meta.url)

describe('server development scripts', () => {
  it('regenerates the Prisma client before starting the development server', async () => {
    const packageJson = JSON.parse(await readFile(fileURLToPath(packageJsonUrl), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts.predev).toBe('npm run db:generate')
  })
})
