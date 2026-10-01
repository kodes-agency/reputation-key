// Portal context — the URLs of the images a published page may show right now.
//
// A snapshot names an image by asset id only. The URL is made here, on every
// read, from the asset's current state: a taken-down, unknown or foreign asset
// is left out and the page falls back to its no-photo look. The URL is on the
// app's own origin; nothing about the object store appears in it.

import { z } from 'zod/v4'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { portalMediaAssetId } from '#/shared/domain/ids'
import { portalMediaPublicPath } from '#/shared/domain/portal-media'
import type { ServableMediaUrls } from '../public-portal-immersive'
import type { PortalMediaAssetRepository } from '../ports/portal-media-asset.repository'

const uuidSchema = z.uuid()

export type ResolvePortalMediaUrlsDeps = Readonly<{
  mediaRepo: Pick<PortalMediaAssetRepository, 'listServableIds'>
}>

export const resolvePortalMediaUrls =
  (deps: ResolvePortalMediaUrlsDeps) =>
  async (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    assetIds: readonly string[],
  ): Promise<ServableMediaUrls> => {
    // A snapshot is verified before it is read, but this is a database query:
    // only well-formed ids are asked about.
    const wellFormed = assetIds.filter((id) => uuidSchema.safeParse(id).success)
    if (wellFormed.length === 0) return {}
    const servable = await deps.mediaRepo.listServableIds(
      organizationId,
      propertyId,
      wellFormed.map(portalMediaAssetId),
    )
    return Object.fromEntries(servable.map((id) => [id, portalMediaPublicPath(id)]))
  }
