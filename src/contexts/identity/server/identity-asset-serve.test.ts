// Identity context — the avatar and organization-logo image route's contract.

import { describe, expect, it, vi } from 'vitest'
import { StoredObjectTooLargeError } from '#/contexts/portal/application/public-api'
import { MAX_UPLOAD_BYTES } from '../application/upload-policy'
import { createIdentityAssetServeHandler } from './identity-asset-serve'

const ASSET = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const AVATAR_KEY = `avatars/user_1/${ASSET}`
const LOGO_KEY = `organizations/org-1/logo/${ASSET}`
const BYTES = new Uint8Array([137, 80, 78, 71, 1, 2, 3])

type Stored = { body: Uint8Array; contentType: string | null } | null

const request = (ifNoneMatch?: string) =>
  new Request('https://app.example.test/api/public/identity-assets/x', {
    headers: ifNoneMatch ? { 'if-none-match': ifNoneMatch } : {},
  })

const handlerFor = (outcome: Stored | Error, referenced = true) => {
  const getObject = vi.fn(async (_key: string, _maxBytes: number) => {
    if (outcome instanceof Error) throw outcome
    return outcome
  })
  const isReferenced = vi.fn(async (_key: string) => referenced)
  const logger = { error: vi.fn() }
  const serve = createIdentityAssetServeHandler({
    storage: { getObject },
    references: { isReferenced },
    logger,
  })
  const handle = (key: string, ifNoneMatch?: string) => serve(request(ifNoneMatch), key)
  return { handle, getObject, isReferenced, logger }
}

describe('identity asset route', () => {
  it.each([AVATAR_KEY, LOGO_KEY])(
    'sends the stored image for %s from the app origin',
    async (key) => {
      const { handle, getObject } = handlerFor({ body: BYTES, contentType: 'image/png' })

      const response = await handle(key)

      expect(response.status).toBe(200)
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES)
      expect(response.headers.get('content-type')).toBe('image/png')
      expect(response.headers.get('content-length')).toBe(String(BYTES.length))
      expect(getObject).toHaveBeenCalledWith(key, MAX_UPLOAD_BYTES)
    },
  )

  it('isolates the image when it is opened on its own', async () => {
    const { handle } = handlerFor({ body: BYTES, contentType: 'image/png' })

    const headers = (await handle(AVATAR_KEY)).headers

    expect(headers.get('x-content-type-options')).toBe('nosniff')
    expect(headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(headers.get('content-disposition')).toBe('inline')
    expect(headers.get('cache-control')).toBe('public, max-age=3600')
  })

  it.each([
    'portal-media/abc.webp',
    `avatars/u/../../portal-media/${ASSET}`,
    `avatars/u/${ASSET}/more`,
    '',
  ])(
    'does not read the store for a key that is not an avatar or logo: %j',
    async (key) => {
      const { handle, getObject } = handlerFor({ body: BYTES, contentType: 'image/png' })

      const response = await handle(key)

      expect(response.status).toBe(404)
      expect(getObject).not.toHaveBeenCalled()
    },
  )

  it.each([AVATAR_KEY, LOGO_KEY])(
    'does not read the store for %s once nothing points at it any more',
    async (key) => {
      const { handle, getObject, isReferenced } = handlerFor(
        { body: BYTES, contentType: 'image/png' },
        false,
      )

      const response = await handle(key)

      expect(response.status).toBe(404)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(isReferenced).toHaveBeenCalledWith(key)
      expect(getObject).not.toHaveBeenCalled()
    },
  )

  it('does not ask who references a key that is not an avatar or logo', async () => {
    const { handle, isReferenced } = handlerFor({ body: BYTES, contentType: 'image/png' })

    await handle('portal-media/abc.webp')

    expect(isReferenced).not.toHaveBeenCalled()
  })

  it('answers 503, uncached, when the reference check fails', async () => {
    const { handle, getObject, isReferenced, logger } = handlerFor({
      body: BYTES,
      contentType: 'image/png',
    })
    isReferenced.mockRejectedValueOnce(new Error('connection terminated'))

    const response = await handle(AVATAR_KEY)

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(getObject).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledOnce()
  })

  it('tags the image with its own id, which never names different bytes', async () => {
    const { handle } = handlerFor({ body: BYTES, contentType: 'image/png' })

    expect((await handle(AVATAR_KEY)).headers.get('etag')).toBe(`"${ASSET}"`)
  })

  it('answers 304 without reading the store when the cache already has the image', async () => {
    const { handle, getObject, isReferenced } = handlerFor({
      body: BYTES,
      contentType: 'image/png',
    })

    const response = await handle(LOGO_KEY, `"${ASSET}"`)

    expect(response.status).toBe(304)
    expect(response.headers.get('etag')).toBe(`"${ASSET}"`)
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(isReferenced).toHaveBeenCalledWith(LOGO_KEY)
    expect(getObject).not.toHaveBeenCalled()
  })

  it('answers 404, not 304, to a cache that holds an image nothing points at any more', async () => {
    const { handle } = handlerFor({ body: BYTES, contentType: 'image/png' }, false)

    expect((await handle(AVATAR_KEY, `"${ASSET}"`)).status).toBe(404)
  })

  it('sends the image again when the cache holds another one', async () => {
    const { handle } = handlerFor({ body: BYTES, contentType: 'image/png' })

    expect((await handle(AVATAR_KEY, '"another"')).status).toBe(200)
  })

  it('answers 404 for an object that is not there', async () => {
    const response = await handlerFor(null).handle(AVATAR_KEY)

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it.each(['text/html', 'image/svg+xml', 'application/octet-stream', null])(
    'never serves an object whose stored type is %s',
    async (contentType) => {
      const response = await handlerFor({ body: BYTES, contentType }).handle(AVATAR_KEY)

      expect(response.status).toBe(404)
    },
  )

  it('answers 404 for an object larger than an upload may be', async () => {
    const response = await handlerFor(new StoredObjectTooLargeError()).handle(AVATAR_KEY)

    expect(response.status).toBe(404)
  })

  it('answers 503, uncached, when the store fails, and logs it without the key', async () => {
    const { handle, logger } = handlerFor(new Error('socket hang up'))

    const response = await handle(AVATAR_KEY)

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('retry-after')).toBe('30')
    expect(logger.error).toHaveBeenCalledOnce()
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(ASSET)
  })
})
