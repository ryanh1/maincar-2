// Unit tests for the S3 wrapper (dependencies/s3.ts).
//
// The recording routes and the upload job mock this module wholesale, so its real
// body only runs here. The AWS SDK and the presigner are mocked at the module
// boundary — there is no MinIO, no bucket, and no signing round-trip — and the
// credentials are set in vi.hoisted() so config.ts reads them at import time. The
// point under test is that the wrapper builds the right commands, hands them to
// the right client, and refuses to run unconfigured.
import { beforeEach, describe, expect, it, vi } from 'vitest'

// config.ts is mocked so the wrapper's credentials are deterministic and never
// touched by the repo-root .env that dotenv would otherwise load.
vi.mock('../../src/config.js', () => ({
  S3_ENDPOINT: 'http://minio.local:9000',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_BUCKET: 'maincar2-local',
}))

const {
  s3ClientCtor,
  sendMock,
  getObjectCtor,
  putObjectCtor,
  getSignedUrlMock,
} = vi.hoisted(() => ({
  s3ClientCtor: vi.fn(),
  sendMock: vi.fn(),
  getObjectCtor: vi.fn(),
  putObjectCtor: vi.fn(),
  getSignedUrlMock: vi.fn(),
}))

vi.mock('@aws-sdk/client-s3', () => ({
  // The constructor records the config it was built with and yields a client whose
  // only method the wrapper uses is send().
  S3Client: class {
    send = sendMock
    constructor(config: unknown) {
      s3ClientCtor(config)
    }
  },
  // Command constructors just capture their input so the test can assert on it.
  GetObjectCommand: class {
    constructor(input: unknown) {
      getObjectCtor(input)
    }
  },
  PutObjectCommand: class {
    constructor(input: unknown) {
      putObjectCtor(input)
    }
  },
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: getSignedUrlMock,
}))

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import {
  getRecordingDownloadUrl,
  putRecording,
  RECORDING_CONTENT_TYPE,
  RECORDING_URL_TTL_SECONDS,
} from '../s3.js'

const KEY = 'maincar-call-recordings/org-a/call-1.mp3'

beforeEach(() => {
  // Clear only the per-call mocks. s3ClientCtor is deliberately left to
  // accumulate: getS3Client() builds one client and caches it, so the ctor is
  // called exactly once for the whole file — which is what the singleton test
  // below asserts.
  getObjectCtor.mockClear()
  putObjectCtor.mockClear()
  getSignedUrlMock.mockClear()
  sendMock.mockClear()
  getSignedUrlMock.mockResolvedValue('https://minio.local/maincar2-local/signed?sig=abc')
  sendMock.mockResolvedValue({})
})

describe('getRecordingDownloadUrl', () => {
  it('signs a GET command for the key in the configured bucket and returns the URL', async () => {
    const url = await getRecordingDownloadUrl(KEY)

    expect(url).toBe('https://minio.local/maincar2-local/signed?sig=abc')
    // A GetObjectCommand was built for the bucket + key.
    expect(getObjectCtor).toHaveBeenCalledWith({ Bucket: 'maincar2-local', Key: KEY })
    // and handed to the presigner with the default one-hour TTL.
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1)
    const [, command, opts] = getSignedUrlMock.mock.calls[0]
    expect(command).toBeInstanceOf(GetObjectCommand)
    expect(opts).toEqual({ expiresIn: RECORDING_URL_TTL_SECONDS })
  })

  it('honours a caller-supplied TTL', async () => {
    await getRecordingDownloadUrl(KEY, 120)

    expect(getSignedUrlMock.mock.calls[0][2]).toEqual({ expiresIn: 120 })
  })

  it('builds the client once and reuses it across calls', async () => {
    await getRecordingDownloadUrl(KEY)
    await getRecordingDownloadUrl(KEY)

    // Lazy singleton: across the whole file the S3Client is constructed exactly
    // once, and with the configured endpoint/region/credentials in path style.
    expect(s3ClientCtor).toHaveBeenCalledTimes(1)
    expect(s3ClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'http://minio.local:9000',
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' },
      }),
    )
  })
})

describe('putRecording', () => {
  it('sends a PUT command with the bytes, key, and default content type', async () => {
    const body = Buffer.from('mp3-bytes')

    await putRecording(KEY, body)

    expect(putObjectCtor).toHaveBeenCalledWith({
      Bucket: 'maincar2-local',
      Key: KEY,
      Body: body,
      ContentType: RECORDING_CONTENT_TYPE,
    })
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand)
  })

  it('honours a caller-supplied content type', async () => {
    await putRecording(KEY, Buffer.from('x'), 'audio/wav')

    expect(putObjectCtor.mock.calls[0][0].ContentType).toBe('audio/wav')
  })
})

describe('when S3 is not configured', () => {
  it('throws a named error, and signs nothing', async () => {
    vi.resetModules()
    // Re-mock config with a blank bucket, then load a fresh copy of the wrapper so
    // its getS3Client() sees the gap.
    vi.doMock('../../src/config.js', () => ({
      S3_ENDPOINT: 'http://minio.local:9000',
      S3_REGION: 'us-east-1',
      S3_ACCESS_KEY_ID: 'test-access-key',
      S3_SECRET_ACCESS_KEY: 'test-secret-key',
      S3_BUCKET: '',
    }))
    try {
      const fresh = await import('../s3.js')
      // getRecordingDownloadUrl is a sync function returning a promise, so the
      // config check throws synchronously — wrap the call so either shape rejects.
      await expect(async () => fresh.getRecordingDownloadUrl(KEY)).rejects.toThrow(
        'S3 is not configured',
      )
      expect(getSignedUrlMock).not.toHaveBeenCalled()
    } finally {
      vi.doUnmock('../../src/config.js')
      vi.resetModules()
    }
  })
})
