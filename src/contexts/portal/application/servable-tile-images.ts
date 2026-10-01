/**
 * Which of the links' tile pictures may still be served. A taken-down picture
 * is left out, so the tile reads as having no photo.
 */

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { portalMediaAssetId } from '#/shared/domain/ids'
import type { PortalLink } from '../domain/types'
import type { PortalMediaAssetRepository } from './ports/portal-media-asset.repository'

export async function listServableTileImageIds(
  mediaRepo: Pick<PortalMediaAssetRepository, 'listServableIds'>,
  organizationId: OrganizationId,
  propertyId: PropertyId,
  links: ReadonlyArray<Pick<PortalLink, 'imageAssetId'>>,
): Promise<ReadonlySet<string>> {
  const pictureIds = links.flatMap((link) =>
    link.imageAssetId ? [portalMediaAssetId(String(link.imageAssetId))] : [],
  )
  if (pictureIds.length === 0) return new Set()
  const servable = await mediaRepo.listServableIds(organizationId, propertyId, pictureIds)
  return new Set(servable.map(String))
}
