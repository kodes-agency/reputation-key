// Portal context — persistence of uploaded image assets.
// Every method takes the Organization: tenant isolation is not optional.

import type { OrganizationId, PortalMediaAssetId, PropertyId } from '#/shared/domain/ids'
import type { PortalMediaAsset } from '../../domain/portal-media-asset'

export type PortalMediaAssetRepository = Readonly<{
  /** Stores a new asset row. The object it names must already be in the store. */
  insert: (asset: PortalMediaAsset) => Promise<void>
  findById: (
    organizationId: OrganizationId,
    assetId: PortalMediaAssetId,
  ) => Promise<PortalMediaAsset | null>
  /** Assets of a Property that have not been taken down. */
  countActiveForProperty: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<number>
}>
