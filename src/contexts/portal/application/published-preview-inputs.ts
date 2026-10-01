// Portal context — what a preview of a published snapshot needs besides the
// snapshot: which of its addresses are still approved, and which of its images
// may still be served. Shared by the live preview and the preview of a chosen
// version, so both draw what guests would be served by the same rules.

import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import {
  IMMERSIVE_HUB_SCHEMA_VERSION,
  type PortalPublicationSnapshot,
} from '../domain/portal-publication-snapshot'
import { APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS } from './approved-destination-age'
import { immersiveAssetIds, type ServableMediaUrls } from './public-portal-immersive'
import { resolvePortalMediaUrls } from './use-cases/resolve-portal-media-urls'
import type { PortalApprovedDestinationRepository } from './ports/portal-approved-destination.repository'
import type { PortalMediaAssetRepository } from './ports/portal-media-asset.repository'

export type PublishedPreviewInputsDeps = Readonly<{
  destinationRepo: Pick<PortalApprovedDestinationRepository, 'listApprovedUris'>
  mediaRepo: Pick<PortalMediaAssetRepository, 'listServableIds'>
  clock: () => Date
}>

export type PublishedPreviewInputs = Readonly<{
  approvedUris: ReadonlySet<string>
  mediaUrls: ServableMediaUrls
}>

export async function readPublishedPreviewInputs(
  deps: PublishedPreviewInputsDeps,
  scope: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  snapshot: PortalPublicationSnapshot,
): Promise<PublishedPreviewInputs> {
  const { configuration } = snapshot
  if (configuration.schemaVersion !== IMMERSIVE_HUB_SCHEMA_VERSION) {
    return { approvedUris: new Set(), mediaUrls: {} }
  }
  const urls = configuration.linktree.enabled
    ? configuration.links.map((link) => link.url)
    : []
  const [approved, mediaUrls] = await Promise.all([
    urls.length === 0
      ? Promise.resolve([])
      : deps.destinationRepo.listApprovedUris(
          scope.organizationId,
          scope.propertyId,
          urls,
          new Date(deps.clock().getTime() - APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS),
        ),
    resolvePortalMediaUrls(deps)(
      scope.organizationId,
      scope.propertyId,
      immersiveAssetIds(configuration),
    ),
  ])
  return { approvedUris: new Set(approved), mediaUrls }
}
