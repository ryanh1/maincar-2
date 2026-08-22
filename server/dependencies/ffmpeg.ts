import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface FfmpegRunInput {
  inputPath: string
  outputPath: string
}

export interface TranscodeWebmToMp3Options {
  run?: (input: FfmpegRunInput) => Promise<void>
}

async function runFfmpeg({ inputPath, outputPath }: FfmpegRunInput): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-vn',
    '-codec:a', 'libmp3lame',
    outputPath,
  ])
}

/**
 * Convert WebM bytes to MP3 using the host ffmpeg binary.
 *
 * ffmpeg needs file paths for reliable format detection, so this deliberately
 * owns a uniquely named temporary directory. The finally block removes both
 * input and output whether conversion succeeds or fails.
 */
export async function transcodeWebmToMp3(
  webm: Buffer,
  options: TranscodeWebmToMp3Options = {},
): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'maincar-greeting-'))
  const inputPath = join(directory, 'source.webm')
  const outputPath = join(directory, 'greeting.mp3')

  try {
    await writeFile(inputPath, webm)
    await (options.run ?? runFfmpeg)({ inputPath, outputPath })
    return await readFile(outputPath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
