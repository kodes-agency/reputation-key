import { GetObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoredObjectTooLargeError } from '../../application/ports/storage.port'
import { buildS3ClientConfigs, createS3StorageAdapter } from './s3-storage.adapter'

const base = {
  accessKey: 'access',
  secretKey: 'secret',
  bucketName: 'bucket',
  region: 'us-east-1',
}

describe('buildS3ClientConfigs', () => {
  it('preserves AWS endpoint discovery when overrides are absent', () => {
    const result = buildS3ClientConfigs(base)
    expect(result.internal).not.toHaveProperty('endpoint')
    expect(result.presign).not.toHaveProperty('endpoint')
    expect(result.internal.forcePathStyle).toBe(false)
  })

  it('splits private operations from browser-reachable signatures', () => {
    const result = buildS3ClientConfigs({
      ...base,
      internalEndpoint: 'http://object-store:9000',
      presignEndpoint: 'http://127.0.0.1:4900',
      forcePathStyle: true,
    })
    expect(result.internal).toMatchObject({
      endpoint: 'http://object-store:9000',
      forcePathStyle: true,
    })
    expect(result.presign).toMatchObject({
      endpoint: 'http://127.0.0.1:4900',
      forcePathStyle: true,
    })
  })

  it('falls back to the internal endpoint for signatures when no public override is set', () => {
    const result = buildS3ClientConfigs({
      ...base,
      internalEndpoint: 'http://object-store:9000',
      forcePathStyle: true,
    })
    expect(result.presign.endpoint).toBe('http://object-store:9000')
  })
})

describe('getObject', () => {
  const store = () => createS3StorageAdapter(base)
  const response = (body: Uint8Array, extra: Record<string, unknown> = {}) => ({
    Body: { transformToByteArray: async () => body },
    ContentLength: body.length,
    ContentType: 'image/webp',
    ...extra,
  })

  afterEach(() => vi.restoreAllMocks())

  it('reads the bytes and the stored content type', async () => {
    const send = vi
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation(async () => response(new Uint8Array([1, 2, 3])) as never)

    const result = await store().getObject('portal-media/a.webp', 100)

    expect(result).toEqual({ body: new Uint8Array([1, 2, 3]), contentType: 'image/webp' })
    expect(send).toHaveBeenCalledOnce()
    const command = send.mock.calls[0]?.[0] as GetObjectCommand
    expect(command).toBeInstanceOf(GetObjectCommand)
    expect(command.input).toMatchObject({ Bucket: 'bucket', Key: 'portal-media/a.webp' })
  })

  it('answers null for an object that is not there', async () => {
    vi.spyOn(S3Client.prototype, 'send').mockRejectedValue(
      new S3ServiceException({
        name: 'NoSuchKey',
        $fault: 'client',
        $metadata: {},
      }),
    )
    expect(await store().getObject('portal-media/a.webp', 100)).toBeNull()
  })

  it('refuses an object that declares more than the cap, without reading it', async () => {
    const transformToByteArray = vi.fn(async () => new Uint8Array(1))
    vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({
      Body: { transformToByteArray },
      ContentLength: 101,
    } as never)

    await expect(store().getObject('portal-media/a.webp', 100)).rejects.toBeInstanceOf(
      StoredObjectTooLargeError,
    )
    expect(transformToByteArray).not.toHaveBeenCalled()
  })

  it('closes the connection of an object it will not read', async () => {
    const destroy = vi.fn()
    vi.spyOn(S3Client.prototype, 'send').mockResolvedValue({
      Body: { transformToByteArray: vi.fn(), destroy },
      ContentLength: 101,
    } as never)

    await expect(store().getObject('portal-media/a.webp', 100)).rejects.toThrow(
      'larger than allowed',
    )
    expect(destroy).toHaveBeenCalledOnce()
  })

  it('refuses an object that turns out larger than it declared', async () => {
    vi.spyOn(S3Client.prototype, 'send').mockResolvedValue(
      response(new Uint8Array(101), { ContentLength: 5 }) as never,
    )
    await expect(store().getObject('portal-media/a.webp', 100)).rejects.toBeInstanceOf(
      StoredObjectTooLargeError,
    )
  })

  it('passes a provider failure on instead of reading it as a missing object', async () => {
    vi.spyOn(S3Client.prototype, 'send').mockRejectedValue(new Error('socket hang up'))
    await expect(store().getObject('portal-media/a.webp', 100)).rejects.toThrow(
      'socket hang up',
    )
  })

  it('is not available when storage is not configured', async () => {
    await expect(
      createS3StorageAdapter({}).getObject('portal-media/a.webp', 100),
    ).rejects.toThrow('not configured')
  })
})
