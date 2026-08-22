import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import {
  S3_ACCESS_KEY_ID,
  S3_BUCKET,
  S3_ENDPOINT,
  S3_REGION,
  S3_SECRET_ACCESS_KEY,
} from '../src/config.js'

// The S3 SDK is constructed HERE and nowhere else (CLAUDE.md → Third-party
// APIs / SDKs). Route and service code calls the functions below; it never
// touches the SDK, and never sees an SDK shape. Local dev is MinIO, production is
// real S3 — the difference is entirely in the env this module reads, so a route
// signing a URL does not know or care which it is talking to.

// One hour — the expiry MAI-28 promises on a recording link. A recording URL is
// handed to a browser that may sit on the page a while before the person clicks
// it, so the window is generous but still bounded.
export const RECORDING_URL_TTL_SECONDS = 3600

// The content type call recordings are stored (and later served) with. Twilio
// hands us MP3, so this is the default the upload job writes.
export const RECORDING_CONTENT_TYPE = 'audio/mpeg'

let client: S3Client | null = null

/**
 * The shared client, built on first use.
 *
 * Lazy on purpose, the same reason twilio.ts is: the S3 credentials are read as
 * `?? ''` in config rather than `required()`, because `/api/health` and the whole
 * unit suite must boot on a machine with no object store. Constructing at import
 * time would take the process down instead. So the failure lands at SIGN time, on
 * the one request that actually needed S3, and names the vars that are missing.
 */
function getS3Client(): S3Client {
  if (client) return client

  if (!S3_ENDPOINT || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !S3_BUCKET) {
    throw new Error(
      'S3 is not configured. Set S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY ' +
        'and S3_BUCKET in .env (see .env.example).',
    )
  }

  client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    // MinIO serves a bucket as a path (`/bucket/key`), not a subdomain, and real
    // S3 accepts path style too — so one setting works for both.
    forcePathStyle: true,
  })
  return client
}

/**
 * A time-limited GET URL for a stored recording object.
 *
 * `objectKey` is the object's path in the bucket, exactly as the upload job wrote
 * it onto the Call row — a bare key, not a link a browser can open. The signature
 * is computed locally, so this makes no network round-trip and does not require
 * the object to exist. The link expires in one hour (RECORDING_URL_TTL_SECONDS),
 * which is why it is signed at request time rather than stored: a URL signed once
 * and kept would be long expired by the time most people clicked it.
 */
export function getRecordingDownloadUrl(
  objectKey: string,
  ttlSeconds: number = RECORDING_URL_TTL_SECONDS,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: objectKey })
  return getSignedUrl(getS3Client(), command, { expiresIn: ttlSeconds })
}

/** A short-lived URL for a private avatar. The key is stored, never this URL. */
export function getAvatarDownloadUrl(objectKey: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: objectKey })
  return getSignedUrl(getS3Client(), command, { expiresIn: 300 })
}

/** A short-lived presigned PUT lets the browser upload directly to MinIO/S3. */
export function presignPut(args: { key: string; contentType: string }): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: args.key,
    ContentType: args.contentType,
  })
  return getSignedUrl(getS3Client(), command, { expiresIn: 300 })
}

export async function headObject(
  key: string,
): Promise<{ contentType: string | undefined; contentLength: number } | null> {
  try {
    const output = await getS3Client().send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }))
    return { contentType: output.ContentType, contentLength: output.ContentLength ?? 0 }
  } catch {
    return null
  }
}

export async function getObjectBytes(key: string): Promise<Buffer> {
  const output = await getS3Client().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }))
  const chunks: Buffer[] = []
  for await (const chunk of output.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

export async function putObjectBytes(args: { key: string; body: Buffer; contentType: string }): Promise<void> {
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: args.key,
      Body: args.body,
      ContentType: args.contentType,
      CacheControl: 'private, max-age=0, no-store',
    }),
  )
}

export async function deleteObject(key: string): Promise<void> {
  await getS3Client().send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }))
}

/**
 * Upload one recording's bytes to `objectKey` in the recordings bucket.
 *
 * `objectKey` is a bare path within the bucket — the same key that later gets
 * handed to `getRecordingDownloadUrl` to sign — so the two agree by construction.
 * The upload job builds the key as `maincar-call-recordings/{orgId}/{callId}.mp3`,
 * which makes a re-run overwrite the same object rather than pile up copies, and
 * that is exactly what keeps the job safe to retry.
 */
export async function putRecording(
  objectKey: string,
  body: Buffer,
  contentType: string = RECORDING_CONTENT_TYPE,
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: objectKey,
    Body: body,
    ContentType: contentType,
  })
  await getS3Client().send(command)
}
