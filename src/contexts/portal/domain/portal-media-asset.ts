// Portal context — an uploaded image as the rest of the context sees it.
//
// A stored asset is the re-encoded image, never the upload. Everything a reader
// needs to serve it lives here: where the bytes are, what they are, and whether
// they may be served.

import type {
  OrganizationId,
  PortalMediaAssetId,
  PropertyId,
  UserId,
} from '#/shared/domain/ids'
import type {
  PortalMediaPurpose,
  PortalMediaSourceFormat,
  PortalMediaStatus,
} from '#/shared/domain/portal-media'

export type PortalMediaAsset = Readonly<{
  id: PortalMediaAssetId
  organizationId: OrganizationId
  propertyId: PropertyId
  purpose: PortalMediaPurpose
  status: PortalMediaStatus
  objectKey: string
  contentType: 'image/webp'
  width: number
  height: number
  byteSize: number
  /** Hex SHA-256 of the stored bytes. */
  contentSha256: string
  sourceFormat: PortalMediaSourceFormat
  sourceBytes: number
  rightsConfirmedAt: Date
  createdBy: UserId
  createdAt: Date
  takenDownAt: Date | null
  /** When the object was removed after a takedown; null while it may still be in the store. */
  objectDeletedAt: Date | null
}>

/** A manager may keep at most this many stored images per Property. */
export const MAX_PORTAL_MEDIA_ASSETS_PER_PROPERTY = 200

/** Whether the asset may be served to a guest. */
export const isServablePortalMediaAsset = (asset: Pick<PortalMediaAsset, 'status'>) =>
  asset.status === 'active'

/**
 * The columns that may point at an asset, and the purpose each one takes. The
 * database ties a reference to an asset of the same Organization and Property
 * but not to its purpose, so whatever writes one of these columns must ask
 * `canReferencePortalMediaAsset` first: a link picture accepted as the hero
 * would skip the hero's minimum size, aspect and byte budget.
 */
export const PORTAL_MEDIA_REFERENCE_SLOTS = Object.freeze({
  brand_hero: 'hero',
  brand_logo: 'logo',
  link_image: 'link_image',
} as const satisfies Record<string, PortalMediaPurpose>)
export type PortalMediaReferenceSlot = keyof typeof PORTAL_MEDIA_REFERENCE_SLOTS

/** Whether `slot` may refer to this asset: the purpose it was uploaded for, and still servable. */
export const canReferencePortalMediaAsset = (
  slot: PortalMediaReferenceSlot,
  asset: Pick<PortalMediaAsset, 'purpose' | 'status'>,
): boolean =>
  asset.purpose === PORTAL_MEDIA_REFERENCE_SLOTS[slot] &&
  isServablePortalMediaAsset(asset)
