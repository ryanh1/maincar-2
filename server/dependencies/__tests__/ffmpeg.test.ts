import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { describe, expect, it } from 'vitest'

import { getAudioDurationSeconds, transcodeWebmToMp3 } from '../ffmpeg.js'

describe('transcodeWebmToMp3', () => {
  it('removes its temporary input and output directory after conversion', async () => {
    let temporaryDirectory = ''

    const mp3 = await transcodeWebmToMp3(Buffer.from('webm'), {
      run: async ({ inputPath, outputPath }) => {
        temporaryDirectory = dirname(inputPath)
        await expect(readFile(inputPath)).resolves.toEqual(Buffer.from('webm'))
        await writeFile(outputPath, Buffer.from('mp3'))
      },
    })

    expect(mp3).toEqual(Buffer.from('mp3'))
    expect(existsSync(temporaryDirectory)).toBe(false)
  })

  it('removes temporary files when ffmpeg fails', async () => {
    let temporaryDirectory = ''

    await expect(
      transcodeWebmToMp3(Buffer.from('webm'), {
        run: async ({ inputPath }) => {
          temporaryDirectory = dirname(inputPath)
          throw new Error('ffmpeg failed')
        },
      }),
    ).rejects.toThrow('ffmpeg failed')

    expect(existsSync(temporaryDirectory)).toBe(false)
  })
})

describe('getAudioDurationSeconds', () => {
  it('reads a positive duration and removes its temporary source', async () => {
    let temporaryDirectory = ''

    await expect(getAudioDurationSeconds(Buffer.from('mp3'), {
      run: async (inputPath) => {
        temporaryDirectory = dirname(inputPath)
        await expect(readFile(inputPath)).resolves.toEqual(Buffer.from('mp3'))
        return '12.4\\n'
      },
    })).resolves.toBe(12.4)

    expect(existsSync(temporaryDirectory)).toBe(false)
  })

  it('rejects an invalid duration and still removes the temporary source', async () => {
    let temporaryDirectory = ''

    await expect(getAudioDurationSeconds(Buffer.from('mp3'), {
      run: async (inputPath) => {
        temporaryDirectory = dirname(inputPath)
        return 'NaN'
      },
    })).rejects.toThrow('invalid audio duration')

    expect(existsSync(temporaryDirectory)).toBe(false)
  })
})
