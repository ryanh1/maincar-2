import { beforeEach, describe, expect, it, vi } from 'vitest'

const { deleteObjectMock, getObjectBytesMock, headObjectMock, presignPutMock, putObjectBytesMock } =
  vi.hoisted(() => ({
    deleteObjectMock: vi.fn(),
    getObjectBytesMock: vi.fn(),
    headObjectMock: vi.fn(),
    presignPutMock: vi.fn(),
    putObjectBytesMock: vi.fn(),
  }))

vi.mock('../../../dependencies/s3.js', () => ({
  deleteObject: deleteObjectMock,
  getObjectBytes: getObjectBytesMock,
  headObject: headObjectMock,
  presignPut: presignPutMock,
  putObjectBytes: putObjectBytesMock,
}))

import {
  acceptAvatarUpload,
  organizationAvatarPrefix,
  presignAvatarUpload,
  userAvatarPrefix,
} from '../avatarUpload.js'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

beforeEach(() => {
  vi.clearAllMocks()
  presignPutMock.mockResolvedValue('http://storage.test/presigned')
  headObjectMock.mockResolvedValue({ contentType: 'image/png', contentLength: PNG.length })
  getObjectBytesMock.mockResolvedValue(PNG)
  putObjectBytesMock.mockResolvedValue(undefined)
  deleteObjectMock.mockResolvedValue(undefined)
})

describe('avatar upload storage boundaries', () => {
  it('presigns a PNG only under the verified user prefix', async () => {
    const target = await presignAvatarUpload({
      prefix: userAvatarPrefix('user-a'),
      contentType: 'image/png',
      size: 1024,
    })

    expect(target.uploadUrl).toBe('http://storage.test/presigned')
    expect(target.objectKey).toMatch(/^avatars\/users\/user-a\/.+\.png$/)
    expect(presignPutMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: expect.stringMatching(/^avatars\/users\/user-a\/.+\.png$/) }),
    )
  })

  it('keeps organization photos in an isolated namespace', () => {
    expect(organizationAvatarPrefix('org-a')).toBe('avatars/organizations/org-a/')
    expect(organizationAvatarPrefix('org-a')).not.toBe(userAvatarPrefix('org-a'))
  })

  it('rejects an uploaded URL outside the expected owner prefix', async () => {
    await expect(
      acceptAvatarUpload({
        objectKey: 'avatars/users/user-b/photo.png',
        prefix: userAvatarPrefix('user-a'),
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('normalizes a verified PNG before persisting its public URL', async () => {
    const objectKey = 'avatars/users/user-a/photo.png'

    await expect(acceptAvatarUpload({ objectKey, prefix: userAvatarPrefix('user-a') })).resolves.toBe(objectKey)
    expect(putObjectBytesMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'avatars/users/user-a/photo.png', contentType: 'image/png' }),
    )
  })
})
