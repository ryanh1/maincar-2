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

export interface ProbeAudioDurationOptions {
  run?: (inputPath: string) => Promise<string>
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

async function runFfprobe(inputPath: string): Promise<string> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    inputPath,
  ])
  return stdout
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

/**
 * Read an audio duration from bytes using ffprobe. Just like transcoding, the
 * bytes are written only to an owned temporary directory and removed on every
 * outcome. Callers get a validated positive, finite duration in seconds.
 */
export async function getAudioDurationSeconds(
  audio: Buffer,
  options: ProbeAudioDurationOptions = {},
): Promise<number> {
  const directory = await mkdtemp(join(tmpdir(), 'maincar-greeting-probe-'))
  const inputPath = join(directory, 'source.audio')

  try {
    await writeFile(inputPath, audio)
    const rawDuration = await (options.run ?? runFfprobe)(inputPath)
    const durationSeconds = Number.parseFloat(rawDuration.trim())

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error('ffprobe returned an invalid audio duration')
    }

    return durationSeconds
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
