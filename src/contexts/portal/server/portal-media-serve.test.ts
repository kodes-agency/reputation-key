// Portal context — the public image route's contract: what a browser, a cache and
// a person who opens the URL directly are told.

import { describe, expect, it, vi } from 'vitest'
import { createPortalMediaServeHandler } from './portal-media-serve'
import type { ServedPortalMedia } from '../application/use-cases/serve-portal-media'

const ID = '30000000-0000-4000-8000-000000000001'
const BYTES = new Uint8Array([82, 73, 70, 70, 1, 2, 3])
const ETAG = `"${'a'.repeat(64)}"`

const handlerFor = (result: ServedPortalMedia | Error) => {
  const serve = vi.fn(async () => {
    if (result instanceof Error) throw result
    return result
  })
  const logger = { error: vi.fn() }
  const handle = createPortalMediaServeHandler({ serve, logger })
  return { handle, serve, logger }
}

const request = (headers: Record<string, string> = {}) =>
  new Request(`https://app.test/api/public/portal-media/${ID}`, { headers })

describe('portal media route', () => {
  it('sends the image with its type, size and etag, from the app’s own origin', async () => {
    const { handle } = handlerFor({
      kind: 'found',
      bytes: BYTES,
      contentType: 'image/webp',
      etag: ETAG,
    })

    const response = await handle(request(), ID)

    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('content-length')).toBe(String(BYTES.length))
    expect(response.headers.get('etag')).toBe(ETAG)
  })

  it('lets a cache keep it for minutes, not longer, so a takedown reaches it', async () => {
    const { handle } = handlerFor({
      kind: 'found',
      bytes: BYTES,
      contentType: 'image/webp',
      etag: ETAG,
    })
    const cacheControl = (await handle(request(), ID)).headers.get('cache-control')
    expect(cacheControl).toBe('public, max-age=300, must-revalidate')
    expect(cacheControl).not.toContain('immutable')
  })

  it('isolates the image when it is opened on its own', async () => {
    const { handle } = handlerFor({
      kind: 'found',
      bytes: BYTES,
      contentType: 'image/webp',
      etag: ETAG,
    })
    const headers = (await handle(request(), ID)).headers
    expect(headers.get('x-content-type-options')).toBe('nosniff')
    expect(headers.get('content-security-policy')).toBe("default-src 'none'; sandbox")
    expect(headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(headers.get('content-disposition')).toBe('inline')
  })

  it('passes the revalidation header to the use case and answers 304 with no body', async () => {
    const { handle, serve } = handlerFor({ kind: 'not_modified', etag: ETAG })

    const response = await handle(request({ 'if-none-match': ETAG }), ID)

    expect(serve).toHaveBeenCalledExactlyOnceWith({ assetId: ID, ifNoneMatch: ETAG })
    expect(response.status).toBe(304)
    expect(await response.text()).toBe('')
    expect(response.headers.get('etag')).toBe(ETAG)
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=300, must-revalidate',
    )
  })

  it('answers 404 and caches nothing for an image that is not served', async () => {
    const { handle } = handlerFor({ kind: 'not_found' })
    const response = await handle(request(), ID)
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('Not found')
  })

  it('answers 503 and caches nothing when the store fails, without echoing the failure', async () => {
    const { handle, logger } = handlerFor(
      new Error('connect ECONNREFUSED bucket.internal'),
    )

    const response = await handle(request(), ID)

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('retry-after')).toBe('30')
    expect(await response.text()).toBe('Unavailable')
    expect(logger.error).toHaveBeenCalledOnce()
    expect(logger.error.mock.calls[0]?.[0]).toMatchObject({
      errorCode: 'portal_media_serve_failed',
    })
  })
})
