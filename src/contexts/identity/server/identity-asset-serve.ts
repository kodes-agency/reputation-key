// Identity context — the public image route for avatars and organization logos
// (GET /api/public/identity-assets/<key>).
//
// The bucket is private and its provider is not ours to hand to a browser, so
// the app reads the object and serves it from its own origin. There is no
// session here: the key carries a random id, only the two key shapes the upload
// use cases issue are readable, and an object is sent only while a user's image
// or an organization's logo still names it (a replaced picture, an upload that
// was never saved and a purged organization's logo are 404). Nothing but a
// raster image type the upload policy allows is ever sent, whatever the object
// claims to be.

import { getContainer } from '#/composition'
import { StoredObjectTooLargeError } from '#/contexts/portal/application/public-api'
import type { StoragePort } from '#/contexts/portal/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { captureObservabilityException } from '#/shared/observability/telemetry'
import { ifNoneMatchMatches, parseIdentityAssetKey } from '../application/identity-assets'
import type { IdentityAssetReferencesPort } from '../application/ports/identity-asset-references.port'
import {
  ALLOWED_IMAGE_CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
} from '../application/upload-policy'

/** A key never holds a different image, so a cache may keep it for a while. */
const CACHEABLE = 'public, max-age=3600'

/** Hardening for the image opened on its own: nothing in it may run or load. */
const ISOLATION = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; sandbox",
  'cross-origin-resource-policy': 'same-origin',
} as const

export type IdentityAssetServeDeps = Readonly<{
  storage: Pick<StoragePort, 'getObject'>
  references: Pick<IdentityAssetReferencesPort, 'isReferenced'>
  logger: Pick<LoggerPort, 'error'>
}>

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
  })

export const createIdentityAssetServeHandler =
  (deps: IdentityAssetServeDeps) =>
  async (request: Request, key: string): Promise<Response> => {
    const parsed = parseIdentityAssetKey(key)
    if (!parsed) return notFound()
    try {
      if (!(await deps.references.isReferenced(key))) return notFound()
      // A key never holds different bytes, so its object id is its entity tag.
      const etag = `"${parsed.objectId}"`
      if (ifNoneMatchMatches(request.headers.get('if-none-match'), etag)) {
        return new Response(null, {
          status: 304,
          headers: { etag, 'cache-control': CACHEABLE },
        })
      }
      const stored = await deps.storage.getObject(key, MAX_UPLOAD_BYTES)
      if (
        !stored?.contentType ||
        !ALLOWED_IMAGE_CONTENT_TYPES.includes(stored.contentType)
      ) {
        return notFound()
      }
      return new Response(Buffer.from(stored.body), {
        status: 200,
        headers: {
          'content-type': stored.contentType,
          'content-length': String(stored.body.length),
          'content-disposition': 'inline',
          etag,
          'cache-control': CACHEABLE,
          ...ISOLATION,
        },
      })
    } catch (error) {
      if (error instanceof StoredObjectTooLargeError) return notFound()
      // The store failed. Not a statement about the image, so nothing is cached.
      deps.logger.error(
        { err: error, errorCode: 'identity_asset_serve_failed' },
        'Identity image could not be read',
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
export const handleIdentityAssetServe = (
  request: Request,
  key: string,
): Promise<Response> => {
  const container = getContainer()
  return createIdentityAssetServeHandler({
    storage: container.assetStorage,
    references: container.identityAssetReferences,
    logger: container.logger,
  })(request, key)
}
