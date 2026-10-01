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
}>

/** A manager may keep at most this many stored images per Property. */
export const MAX_PORTAL_MEDIA_ASSETS_PER_PROPERTY = 200

/** Whether the asset may be served to a guest. */
export const isServablePortalMediaAsset = (asset: Pick<PortalMediaAsset, 'status'>) =>
  asset.status === 'active'
