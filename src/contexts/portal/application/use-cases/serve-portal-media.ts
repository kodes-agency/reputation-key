// Portal context — serve one stored image to a guest.
//
// The bucket is private and no provider URL ever reaches a browser: the image is
// read here and sent from the app's own origin. A guest has no tenant, so the
// asset is found by its id alone; the id is a random UUID and acts as the
// capability, as a Portal token does. Whether the asset may be served is decided
// on every request from its row, so a takedown works at once on snapshots that
// can never change.
//
// The row is the authority for what the bytes are: the content type, the size
// and the hash all come from it, and bytes that disagree are not served.

import { z } from 'zod/v4'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { portalMediaAssetId } from '#/shared/domain/ids'
import { PORTAL_MEDIA_STORED_CONTENT_TYPE } from '#/shared/domain/portal-media'
import { isServablePortalMediaAsset } from '../../domain/portal-media-asset'
import type { PortalMediaAssetRepository } from '../ports/portal-media-asset.repository'
import type { StoragePort } from '../ports/storage.port'

export type ServePortalMediaDeps = Readonly<{
  mediaRepo: Pick<PortalMediaAssetRepository, 'findForPublicRead'>
  objectStore: Pick<StoragePort, 'getObject'>
  sha256Hex: (bytes: Uint8Array) => string
  logger: Pick<LoggerPort, 'error'>
}>

export type ServePortalMediaInput = Readonly<{
  assetId: string
  /** The request's If-None-Match header, if it had one. */
  ifNoneMatch?: string | null
}>

export type ServedPortalMedia =
  | Readonly<{ kind: 'not_found' }>
  | Readonly<{ kind: 'not_modified'; etag: string }>
  | Readonly<{
      kind: 'found'
      bytes: Uint8Array
      contentType: typeof PORTAL_MEDIA_STORED_CONTENT_TYPE
      etag: string
    }>

const NOT_FOUND: ServedPortalMedia = Object.freeze({ kind: 'not_found' })

const uuidSchema = z.uuid()

/** The entity tag of an asset: the hash of the bytes this system encoded. */
const etagOf = (contentSha256: string): string => `"${contentSha256}"`

/** Whether an If-None-Match header names `etag` (weak comparison, as the spec asks for GET). */
export function ifNoneMatchMatches(header: string | null | undefined, etag: string) {
  if (!header) return false
  if (header.trim() === '*') return true
  const bare = (value: string) => value.trim().replace(/^W\//u, '')
  return header.split(',').some((candidate) => bare(candidate) === etag)
}

export const servePortalMedia =
  (deps: ServePortalMediaDeps) =>
  async (input: ServePortalMediaInput): Promise<ServedPortalMedia> => {
    if (!uuidSchema.safeParse(input.assetId).success) return NOT_FOUND

    const asset = await deps.mediaRepo.findForPublicRead(
      portalMediaAssetId(input.assetId),
    )
    if (!asset || !isServablePortalMediaAsset(asset)) return NOT_FOUND

    const etag = etagOf(asset.contentSha256)
    if (ifNoneMatchMatches(input.ifNoneMatch, etag)) {
      return { kind: 'not_modified', etag }
    }

    const object = await deps.objectStore.getObject(asset.objectKey, asset.byteSize)
    if (!object) return refuse(deps, asset.id, 'portal_media_object_missing')
    if (
      object.body.length !== asset.byteSize ||
      deps.sha256Hex(object.body) !== asset.contentSha256
    ) {
      return refuse(deps, asset.id, 'portal_media_object_mismatch')
    }

    return {
      kind: 'found',
      bytes: object.body,
      contentType: PORTAL_MEDIA_STORED_CONTENT_TYPE,
      etag,
    }
  }

/** An object that is gone or is not what was stored. Content-free: an id and a code. */
function refuse(
  deps: ServePortalMediaDeps,
  assetId: string,
  errorCode: 'portal_media_object_missing' | 'portal_media_object_mismatch',
): ServedPortalMedia {
  deps.logger.error({ assetId, errorCode }, 'Portal media object is not servable')
  return NOT_FOUND
}

export type ServePortalMedia = ReturnType<typeof servePortalMedia>
