import { randomUUID } from 'node:crypto'

import {
  deleteObject,
  getObjectBytes,
  headObject,
  presignPut,
  putObjectBytes,
} from '../../dependencies/s3.js'
import { sanitizePng } from './png.js'

export const AVATAR_CONTENT_TYPE = 'image/png'
export const MAX_AVATAR_BYTES = 8 * 1024 * 1024

export class AvatarUploadError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function userAvatarPrefix(userId: string): string {
  return `avatars/users/${userId}/`
}

export function organizationAvatarPrefix(orgId: string): string {
  return `avatars/organizations/${orgId}/`
}

export interface AvatarUploadTarget {
  uploadUrl: string
  objectKey: string
}

export async function presignAvatarUpload(args: {
  prefix: string
  contentType: unknown
  size: unknown
}): Promise<AvatarUploadTarget> {
  if (typeof args.contentType !== 'string' || typeof args.size !== 'number' || args.size <= 0) {
    throw new AvatarUploadError(400, 'The upload request was not understood.')
  }
  if (args.contentType !== AVATAR_CONTENT_TYPE) {
    throw new AvatarUploadError(415, 'A photo must be uploaded as a PNG.')
  }
  if (args.size > MAX_AVATAR_BYTES) {
    throw new AvatarUploadError(413, 'That image is too large. The limit is 8MB after cropping.')
  }

  const key = `${args.prefix}${randomUUID()}.png`
  return { uploadUrl: await presignPut({ key, contentType: AVATAR_CONTENT_TYPE }), objectKey: key }
}

export async function acceptAvatarUpload(args: { objectKey: string; prefix: string }): Promise<string> {
  const key = args.objectKey
  if (!key.startsWith(args.prefix)) {
    throw new AvatarUploadError(403, 'That photo does not belong here.')
  }

  const head = await headObject(key)
  if (!head) throw new AvatarUploadError(404, 'The uploaded photo could not be found. Try again.')
  if (head.contentLength > MAX_AVATAR_BYTES) {
    await deleteObject(key)
    throw new AvatarUploadError(413, 'That image is too large. The limit is 8MB after cropping.')
  }
  if (head.contentType !== AVATAR_CONTENT_TYPE) {
    await deleteObject(key)
    throw new AvatarUploadError(415, 'A photo must be a PNG.')
  }

  const sanitized = sanitizePng(await getObjectBytes(key))
  if (!sanitized) {
    await deleteObject(key)
    throw new AvatarUploadError(415, 'That file is not a readable image.')
  }
  await putObjectBytes({ key, body: sanitized, contentType: AVATAR_CONTENT_TYPE })
  return key
}

/** Stored values are verified object keys; null means no uploaded photo. */
export function avatarObjectKey(value: string | null): string | null {
  return value
}
