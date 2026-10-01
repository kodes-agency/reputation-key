// The adapter against an S3-compatible store that is not AWS: Railway's bucket
// (region "auto", endpoint https://t3.storageapi.dev, virtual-host URLs) and a
// local path-style store. A small in-process S3 stands in for the store so the
// real SDK signs, sends and reads over HTTP.

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { storageConnectSources } from '#/shared/security/security-headers'
import { createS3StorageAdapter, type S3StorageConfig } from './s3-storage.adapter'

const RAILWAY: S3StorageConfig = {
  accessKey: 'access',
  secretKey: 'secret',
  bucketName: 'object-store-ab12cd34',
  region: 'auto',
  internalEndpoint: 'https://t3.storageapi.dev',
  presignEndpoint: 'https://t3.storageapi.dev',
  forcePathStyle: false,
}

type StoredObject = { body: Buffer; contentType: string }

describe('Railway bucket (region auto, virtual-host style)', () => {
  const adapter = createS3StorageAdapter(RAILWAY)

  it('signs a browser upload against the bucket sub-domain of the configured endpoint', async () => {
    const { uploadUrl, key } = await adapter.createPresignedUploadUrl(
      'avatars/user-1/asset-1',
      'image/png',
      1024,
    )

    const url = new URL(uploadUrl)
    expect(key).toBe('avatars/user-1/asset-1')
    expect(url.origin).toBe('https://object-store-ab12cd34.t3.storageapi.dev')
    expect(url.pathname).toBe('/avatars/user-1/asset-1')
    expect(url.searchParams.get('X-Amz-Credential')).toContain('/auto/s3/aws4_request')
  })

  it('leaves no checksum of an empty body in the signature, which a real upload would fail', async () => {
    const { uploadUrl } = await adapter.createPresignedUploadUrl('k', 'image/png', 1024)

    const names = [...new URL(uploadUrl).searchParams.keys()].map((n) => n.toLowerCase())
    expect(names.filter((n) => n.includes('checksum'))).toEqual([])
  })

  it('lets the page connect to exactly the origin the upload is signed for', async () => {
    const { uploadUrl } = await adapter.createPresignedUploadUrl('k', 'image/png', 1024)

    expect(
      storageConnectSources({
        S3_PRESIGN_ENDPOINT: RAILWAY.presignEndpoint,
        AWS_S3_BUCKET_NAME: RAILWAY.bucketName,
        AWS_S3_REGION: RAILWAY.region,
        S3_FORCE_PATH_STYLE: 'false',
      }),
    ).toEqual([new URL(uploadUrl).origin])
  })
})

describe('the page may connect to wherever an upload is signed for', () => {
  const cases: ReadonlyArray<Readonly<{ name: string; config: S3StorageConfig }>> = [
    { name: 'virtual-host on a hosted endpoint', config: RAILWAY },
    {
      name: 'path style on a hosted endpoint',
      config: { ...RAILWAY, forcePathStyle: true },
    },
    {
      name: 'a custom port',
      config: {
        ...RAILWAY,
        internalEndpoint: 'https://t3.storageapi.dev:8443',
        presignEndpoint: 'https://t3.storageapi.dev:8443',
      },
    },
    {
      name: 'a loopback address (the SDK falls back to path style)',
      config: {
        ...RAILWAY,
        bucketName: 'repkey-e2e',
        internalEndpoint: 'http://127.0.0.1:4900',
        presignEndpoint: 'http://127.0.0.1:4900',
      },
    },
    {
      name: 'localhost (a sub-domain of it is signed)',
      config: {
        ...RAILWAY,
        bucketName: 'repkey-e2e',
        internalEndpoint: 'http://localhost:4900',
        presignEndpoint: 'http://localhost:4900',
      },
    },
    {
      name: 'an IPv6 loopback address',
      config: {
        ...RAILWAY,
        bucketName: 'repkey-e2e',
        internalEndpoint: 'http://[::1]:4900',
        presignEndpoint: 'http://[::1]:4900',
      },
    },
    {
      name: 'a bucket name that is not a DNS label',
      config: { ...RAILWAY, bucketName: 'My_Bucket' },
    },
    {
      name: 'a bucket name with dots',
      config: { ...RAILWAY, bucketName: 'my.bucket.name' },
    },
    {
      name: 'no separate presign endpoint (the internal one signs)',
      config: { ...RAILWAY, presignEndpoint: undefined },
    },
  ]

  it.each(cases)('$name', async ({ config }) => {
    const { uploadUrl } = await createS3StorageAdapter(config).createPresignedUploadUrl(
      'k',
      'image/png',
      1024,
    )

    expect(
      storageConnectSources({
        S3_PRESIGN_ENDPOINT: config.presignEndpoint,
        S3_INTERNAL_ENDPOINT: config.internalEndpoint,
        AWS_S3_BUCKET_NAME: config.bucketName,
        AWS_S3_REGION: config.region,
        S3_FORCE_PATH_STYLE: String(config.forcePathStyle ?? false),
      }),
    ).toEqual([new URL(uploadUrl).origin])
  })
})

describe('against a local S3-compatible store (path style)', () => {
  const objects = new Map<string, StoredObject>()
  const requests: Array<{ method: string; path: string; search: URLSearchParams }> = []
  let server: Server
  let config: S3StorageConfig

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://local')
      requests.push({
        method: req.method ?? '',
        path: url.pathname,
        search: url.searchParams,
      })
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        const stored = objects.get(url.pathname)
        if (req.method === 'PUT') {
          objects.set(url.pathname, {
            body: Buffer.concat(chunks),
            contentType: String(req.headers['content-type'] ?? ''),
          })
          res.writeHead(200).end()
        } else if (!stored) {
          res.writeHead(404, { 'content-type': 'application/xml' })
          res.end('<Error><Code>NoSuchKey</Code></Error>')
        } else {
          res.writeHead(200, {
            'content-type': stored.contentType,
            'content-length': String(stored.body.length),
          })
          res.end(req.method === 'HEAD' ? undefined : stored.body)
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    config = {
      accessKey: 'access',
      secretKey: 'secret',
      bucketName: 'repkey-test',
      region: 'auto',
      internalEndpoint: origin,
      presignEndpoint: origin,
      forcePathStyle: true,
    }
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  it('takes a browser upload by the signed URL and finds it again', async () => {
    const adapter = createS3StorageAdapter(config)
    const { uploadUrl } = await adapter.createPresignedUploadUrl(
      'avatars/u/1',
      'image/png',
      1024,
    )

    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array([1, 2, 3, 4]),
    })

    expect(put.status).toBe(200)
    expect(requests.at(-1)?.path).toBe('/repkey-test/avatars/u/1')
    expect(await adapter.inspectObject?.('avatars/u/1')).toEqual({
      contentType: 'image/png',
      sizeBytes: 4,
    })
    expect(await adapter.getObject('avatars/u/1', 100)).toEqual({
      body: new Uint8Array([1, 2, 3, 4]),
      contentType: 'image/png',
    })
  })

  it('confirms an upload that is there without handing back a provider URL', async () => {
    const adapter = createS3StorageAdapter(config)
    await adapter.putObject('avatars/u/2', Buffer.from('x'), 'image/png')

    await expect(adapter.confirmUpload('avatars/u/2')).resolves.toBeUndefined()
  })

  it('refuses to confirm an upload that never arrived', async () => {
    await expect(
      createS3StorageAdapter(config).confirmUpload('avatars/u/missing'),
    ).rejects.toMatchObject({ name: 'NotFound' })
  })

  it('writes and reads server-side without a checksum trailer the store may not parse', async () => {
    const adapter = createS3StorageAdapter(config)

    await adapter.putObject('portal-media/a.webp', Buffer.from('webp'), 'image/webp')

    expect(await adapter.getObject('portal-media/a.webp', 100)).toEqual({
      body: new Uint8Array(Buffer.from('webp')),
      contentType: 'image/webp',
    })
    expect(objects.get('/repkey-test/portal-media/a.webp')?.body.toString()).toBe('webp')
  })
})
