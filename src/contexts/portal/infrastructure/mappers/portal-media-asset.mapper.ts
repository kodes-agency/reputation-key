// Portal context — portal_media_assets row <-> PortalMediaAsset.

import type { portalMediaAssets } from '#/shared/db/schema/portal-assets.schema'
import {
  organizationId,
  portalMediaAssetId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type {
  PortalMediaPurpose,
  PortalMediaSourceFormat,
  PortalMediaStatus,
} from '#/shared/domain/portal-media'
import type { PortalMediaAsset } from '../../domain/portal-media-asset'

type Row = typeof portalMediaAssets.$inferSelect

export const portalMediaAssetFromRow = (row: Row): PortalMediaAsset => ({
  id: portalMediaAssetId(row.id),
  organizationId: organizationId(row.organizationId),
  propertyId: propertyId(row.propertyId),
  // The CHECK constraints keep these columns inside their closed sets.
  purpose: row.purpose as PortalMediaPurpose,
  status: row.status as PortalMediaStatus,
  objectKey: row.objectKey,
  contentType: 'image/webp',
  width: row.width,
  height: row.height,
  byteSize: row.byteSize,
  contentSha256: row.contentSha256,
  sourceFormat: row.sourceFormat as PortalMediaSourceFormat,
  sourceBytes: row.sourceBytes,
  rightsConfirmedAt: row.rightsConfirmedAt,
  createdBy: userId(row.createdBy),
  createdAt: row.createdAt,
  takenDownAt: row.takenDownAt,
  objectDeletedAt: row.objectDeletedAt,
})

export const portalMediaAssetToRow = (asset: PortalMediaAsset): Row => ({
  id: asset.id,
  organizationId: asset.organizationId,
  propertyId: asset.propertyId,
  purpose: asset.purpose,
  status: asset.status,
  objectKey: asset.objectKey,
  contentType: asset.contentType,
  width: asset.width,
  height: asset.height,
  byteSize: asset.byteSize,
  contentSha256: asset.contentSha256,
  sourceFormat: asset.sourceFormat,
  sourceBytes: asset.sourceBytes,
  rightsConfirmedAt: asset.rightsConfirmedAt,
  createdBy: asset.createdBy,
  createdAt: asset.createdAt,
  takenDownAt: asset.takenDownAt,
  objectDeletedAt: asset.objectDeletedAt,
})
