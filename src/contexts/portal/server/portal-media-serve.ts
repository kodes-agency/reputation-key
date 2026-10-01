// Portal context — the public image route (GET /api/public/portal-media/:assetId).
//
// The one place a guest's browser gets a stored image. It is served from the app's
// own origin: the bucket is private and no provider URL, bucket name or object key
// reaches the page. There is no session and no tenant here; the asset's random
// id is the capability, and what may be served is decided from its row on every
// request (see the use case).
//
// Caching is short on purpose. An image is addressed by a stable id, so it may be
// held by a browser or a shared cache, but a takedown has to reach them: the
// lifetime below is the longest a taken-down image can still be seen by someone
// who already has it. Revalidation is by hash, and costs no read from the store.

import { getContainer } from '#/composition'
import { captureObservabilityException } from '#/shared/observability/telemetry'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ServePortalMedia } from '../application/use-cases/serve-portal-media'

/** Seconds a cache may keep an image without asking again: the takedown latency. */
export const PORTAL_MEDIA_MAX_AGE_SECONDS = 300

const CACHEABLE = `public, max-age=${PORTAL_MEDIA_MAX_AGE_SECONDS}, must-revalidate`

/** Hardening for the image opened on its own: nothing in it may run or load. */
const ISOLATION = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; sandbox",
  'cross-origin-resource-policy': 'same-origin',
} as const

export type PortalMediaServeDeps = Readonly<{
  serve: ServePortalMedia
  logger: Pick<LoggerPort, 'error'>
}>

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
  })

export const createPortalMediaServeHandler =
  (deps: PortalMediaServeDeps) =>
  async (request: Request, assetId: string): Promise<Response> => {
    try {
      const result = await deps.serve({
        assetId,
        ifNoneMatch: request.headers.get('if-none-match'),
      })
      switch (result.kind) {
        case 'not_found':
          return notFound()
        case 'not_modified':
          return new Response(null, {
            status: 304,
            headers: { etag: result.etag, 'cache-control': CACHEABLE },
          })
        case 'found':
          return new Response(Buffer.from(result.bytes), {
            status: 200,
            headers: {
              'content-type': result.contentType,
              'content-length': String(result.bytes.length),
              'content-disposition': 'inline',
              etag: result.etag,
              'cache-control': CACHEABLE,
              ...ISOLATION,
            },
          })
      }
    } catch (error) {
      // The store (or the database) failed. Not a statement about the image, so
      // nothing is cached, and the error carries no tenant content.
      deps.logger.error(
        { err: error, errorCode: 'portal_media_serve_failed' },
        'Portal media could not be read',
      )
      captureObservabilityException(error, { source: 'nitro' })
      return new Response('Unavailable', {
        status: 503,
        headers: {
          'cache-control': 'no-store',
          'retry-after': '30',
          'content-type': 'text/plain; charset=utf-8',
        },
      })
    }
  }

/** The handler wired to the running app. */
export const handlePortalMediaServe = (
  request: Request,
  assetId: string,
): Promise<Response> => {
  const container = getContainer()
  return createPortalMediaServeHandler({
    serve: container.portalPublicApi.portal.servePortalMedia,
    logger: container.logger,
  })(request, assetId)
}
