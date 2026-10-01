// Portal context — server-side image ingest.
//
// The one way an image enters the Portal. The manager's bytes arrive here; what
// leaves is a stored WebP this system encoded itself, and a row that describes
// it. Nothing a browser sent is stored or served.
//
// Order matters: every cheap check (who, which Property, the rights
// confirmation, the size and type of the bytes) runs before the decoder is
// touched, and the decoder runs before anything is written. A refusal therefore
// stores nothing. The object is written before its row so a row never names a
// missing object; if the row then fails, the object is removed again.

import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  portalId as toPortalId,
  portalMediaAssetId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { canForContext, type Permission } from '#/shared/domain/permissions'
import {
  PORTAL_MEDIA_STORED_CONTENT_TYPE,
  portalMediaObjectKey,
  type PortalMediaPurpose,
} from '#/shared/domain/portal-media'
import { portalError } from '../../domain/errors'
import {
  assessEncodedImage,
  assessUpload,
  planReencode,
  portalImageRejection,
} from '../../domain/portal-image-policy'
import {
  MAX_PORTAL_MEDIA_ASSETS_PER_PROPERTY,
  type PortalMediaAsset,
} from '../../domain/portal-media-asset'
import { assertPropertyAccess } from '../assert-property-access'
import type { ImageProcessorPort } from '../ports/image-processor.port'
import type { PortalMediaAssetRepository } from '../ports/portal-media-asset.repository'
import type { PortalRepository } from '../ports/portal.repository'
import type { StoragePort } from '../ports/storage.port'

export type IngestPortalImageInput = Readonly<{
  propertyId: string
  /** The Portal whose link tile carries the picture; required for `link_image`, ignored otherwise. */
  portalId?: string
  purpose: PortalMediaPurpose
  /** What the browser said the bytes are. The bytes are checked against it. */
  declaredContentType: string
  bytes: Uint8Array
  /** The uploader's confirmation that they hold the rights to the image. */
  rightsConfirmed: boolean
}>

export type IngestedPortalImage = Readonly<{
  assetId: string
  purpose: PortalMediaPurpose
  width: number
  height: number
  byteSize: number
  contentType: typeof PORTAL_MEDIA_STORED_CONTENT_TYPE
}>

export type IngestPortalImageDeps = Readonly<{
  portalRepo: PortalRepository
  staffPublicApi: StaffPublicApi
  propertyApi: Pick<PropertyPublicApi, 'propertyExists'>
  mediaRepo: PortalMediaAssetRepository
  objectStore: Pick<StoragePort, 'putObject' | 'deleteObject'>
  imageProcessor: ImageProcessorPort
  sha256Hex: (bytes: Uint8Array) => string
  idGen: () => string
  clock: () => Date
  logger: Pick<LoggerPort, 'error'>
}>

/**
 * A Property's photograph and logo are Property-wide branding, which only an
 * Account Admin changes (as with the Brand Profile); a link tile's picture is
 * link content, which a Property Manager edits.
 */
export const portalImagePermission = (purpose: PortalMediaPurpose): Permission =>
  purpose === 'link_image' ? 'portal.update' : 'portal.admin'

export const ingestPortalImage =
  (deps: IngestPortalImageDeps) =>
  async (
    input: IngestPortalImageInput,
    ctx: AuthContext,
  ): Promise<IngestedPortalImage> => {
    const permission = portalImagePermission(input.purpose)
    if (!canForContext(ctx, permission)) {
      throw portalError('forbidden', 'Insufficient permissions to upload this image')
    }

    const propertyId = toPropertyId(input.propertyId)
    if (!(await deps.propertyApi.propertyExists(ctx.organizationId, propertyId))) {
      throw portalError('property_not_found', 'property not found in this organization')
    }
    await assertPropertyAccess(deps.staffPublicApi, ctx, permission, propertyId)
    if (input.purpose === 'link_image') {
      const portal = input.portalId
        ? await deps.portalRepo.findById(ctx.organizationId, toPortalId(input.portalId))
        : null
      if (!portal || portal.propertyId !== propertyId) {
        throw portalError('portal_not_found', 'portal not found in this organization')
      }
    }

    if (!input.rightsConfirmed) throw portalImageRejection('rights_not_confirmed')
    const upload = assessUpload({
      declaredContentType: input.declaredContentType,
      bytes: input.bytes,
    })
    if (upload.isErr()) throw upload.error
    const activeAssets = await deps.mediaRepo.countActiveForProperty(
      ctx.organizationId,
      propertyId,
    )
    if (activeAssets >= MAX_PORTAL_MEDIA_ASSETS_PER_PROPERTY) {
      throw portalImageRejection('asset_limit_reached')
    }

    const facts = await deps.imageProcessor.inspect(input.bytes)
    const plan = planReencode(input.purpose, facts)
    if (plan.isErr()) throw plan.error
    const encoded = assessEncodedImage(
      input.purpose,
      plan.value,
      await deps.imageProcessor.reencode(input.bytes, plan.value),
    )
    if (encoded.isErr()) throw encoded.error

    const now = deps.clock()
    const id = portalMediaAssetId(deps.idGen())
    const { bytes, width, height } = encoded.value
    const asset: PortalMediaAsset = {
      id,
      organizationId: ctx.organizationId,
      propertyId,
      purpose: input.purpose,
      status: 'active',
      objectKey: portalMediaObjectKey(id),
      contentType: PORTAL_MEDIA_STORED_CONTENT_TYPE,
      width,
      height,
      byteSize: bytes.length,
      contentSha256: deps.sha256Hex(bytes),
      sourceFormat: upload.value,
      sourceBytes: input.bytes.length,
      rightsConfirmedAt: now,
      createdBy: ctx.userId,
      createdAt: now,
      takenDownAt: null,
    }

    await storeObject(deps, asset, bytes)
    try {
      await deps.mediaRepo.insert(asset)
    } catch (error) {
      await removeOrphan(deps, asset)
      throw error
    }

    return {
      assetId: asset.id,
      purpose: asset.purpose,
      width: asset.width,
      height: asset.height,
      byteSize: asset.byteSize,
      contentType: asset.contentType,
    }
  }

async function storeObject(
  deps: IngestPortalImageDeps,
  asset: PortalMediaAsset,
  bytes: Uint8Array,
): Promise<void> {
  try {
    await deps.objectStore.putObject(
      asset.objectKey,
      Buffer.from(bytes),
      PORTAL_MEDIA_STORED_CONTENT_TYPE,
    )
  } catch (error) {
    // The caller gets a bare refusal; the cause stays here, where a bucket or
    // credential misconfiguration can be found. The image itself is not logged.
    deps.logger.error(
      { err: error, assetId: asset.id, errorCode: 'portal_media_store_failed' },
      'Portal media object could not be stored',
    )
    throw portalError('upload_failed', 'The image could not be stored')
  }
}

/** The row failed after the object was written; take the object back, or say it is left. */
async function removeOrphan(
  deps: IngestPortalImageDeps,
  asset: PortalMediaAsset,
): Promise<void> {
  try {
    await deps.objectStore.deleteObject(asset.objectKey)
  } catch {
    // Content-free: an id, never the image or the uploader.
    deps.logger.error(
      { assetId: asset.id, errorCode: 'portal_media_orphan_object' },
      'Portal media object left behind (orphan) after its row failed to write',
    )
  }
}

export type IngestPortalImage = ReturnType<typeof ingestPortalImage>
