// Portal context — the asset a reference slot may point at.
//
// The database ties a reference (a link's picture, the Brand Profile's hero or
// logo) to an asset of the same Organization and Property, but not to the
// asset's purpose or state, so every writer asks here first: the asset must be
// of this Organization and Property, uploaded for this slot's purpose, and still
// servable. Anything else (an id that is not a UUID, an unknown or another
// tenant's asset, a taken-down one, a picture for another purpose) is the same
// answer, null, so a caller refuses all of them as one "image not found" and a
// probe learns nothing about other tenants' images.

import { z } from 'zod/v4'
import {
  portalMediaAssetId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import {
  canReferencePortalMediaAsset,
  type PortalMediaAsset,
  type PortalMediaReferenceSlot,
} from '../domain/portal-media-asset'
import type { PortalMediaAssetRepository } from './ports/portal-media-asset.repository'

const uuidSchema = z.uuid()

export async function findReferencableMediaAsset(
  mediaRepo: Pick<PortalMediaAssetRepository, 'findById'>,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  slot: PortalMediaReferenceSlot,
  assetId: string,
): Promise<PortalMediaAsset | null> {
  if (!uuidSchema.safeParse(assetId).success) return null
  const asset = await mediaRepo.findById(organizationId, portalMediaAssetId(assetId))
  if (!asset || asset.propertyId !== propertyId) return null
  return canReferencePortalMediaAsset(slot, asset) ? asset : null
}
