// The closed vocabulary of Portal media: what an uploaded image is for, where it
// is in its life, and where its bytes live.
//
// Pure on purpose (no zod, no I/O) so domain code may import it; the SQL
// rendering for the Drizzle model and the hand-written migration lives in
// `src/shared/portal-media-schemas.ts`.

/** A Property's photograph, its logo, or the picture on one link tile. */
export const PORTAL_MEDIA_PURPOSES = Object.freeze([
  'hero',
  'logo',
  'link_image',
] as const)
export type PortalMediaPurpose = (typeof PORTAL_MEDIA_PURPOSES)[number]

/**
 * `taken_down` assets stay in the table, because published snapshots refer to
 * them by id, but are never served: a takedown works on immutable snapshots.
 */
export const PORTAL_MEDIA_STATUSES = Object.freeze(['active', 'taken_down'] as const)
export type PortalMediaStatus = (typeof PORTAL_MEDIA_STATUSES)[number]

/** The formats an upload may arrive in. Everything stored is WebP. */
export const PORTAL_MEDIA_SOURCE_FORMATS = Object.freeze(['jpeg', 'png', 'webp'] as const)
export type PortalMediaSourceFormat = (typeof PORTAL_MEDIA_SOURCE_FORMATS)[number]

export const PORTAL_MEDIA_STORED_CONTENT_TYPE = 'image/webp'

/**
 * The largest image body accepted, 10 MiB: a phone photograph is 2 to 6, and it
 * is the ceiling the retired hero upload used. One value for the policy that
 * refuses a larger body and for the request guard that stops it at the edge.
 */
export const PORTAL_MEDIA_MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/** Where the browser sends an image: a POST of the raw bytes, same-origin. */
export const PORTAL_MEDIA_UPLOAD_PATH = '/api/portal-media'

const OBJECT_KEY_PREFIX = 'portal-media/'

/**
 * Where an asset's bytes live. Derived from the asset id alone, so no
 * manager-supplied text reaches an object key, and a row whose key is anything
 * else is refused by the database.
 */
export const portalMediaObjectKey = (assetId: string): string =>
  `${OBJECT_KEY_PREFIX}${assetId}.webp`

/** Where a guest's browser fetches a stored image: same-origin, by the asset's id. */
export const PORTAL_MEDIA_PUBLIC_PATH = '/api/public/portal-media'

/**
 * The URL a published page uses for an asset. Made when the page is read, never
 * stored in a snapshot, so a takedown reaches pages that can never change.
 */
export const portalMediaPublicPath = (assetId: string): string =>
  `${PORTAL_MEDIA_PUBLIC_PATH}/${assetId}`
