// Portal context — persistence of uploaded image assets.
// Every method takes the Organization: tenant isolation is not optional. The two
// that do not are named for what they are and nothing else: the public read by
// the unguessable asset id, and the sweeps that clean up across tenants.

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

  /**
   * The public read: an asset by its id alone, because a guest has no tenant.
   * The id is a random UUID and is the capability, exactly as a Portal token is;
   * the caller serves it only if it is still servable.
   */
  findForPublicRead: (assetId: PortalMediaAssetId) => Promise<PortalMediaAsset | null>
  /**
   * The ids, out of `assetIds`, that belong to this Property and may be served
   * right now. An id that is unknown, another Property's or taken down is left out.
   */
  listServableIds: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
    assetIds: readonly PortalMediaAssetId[],
  ) => Promise<readonly PortalMediaAssetId[]>

  /**
   * Stops an active asset being served. Returns the updated asset, or null when it
   * is not an active asset of this Organization (already taken down, or not theirs).
   */
  markTakenDown: (
    organizationId: OrganizationId,
    assetId: PortalMediaAssetId,
    at: Date,
  ) => Promise<PortalMediaAsset | null>
  /** Records that a taken-down asset's object is gone. Idempotent. */
  markObjectDeleted: (
    organizationId: OrganizationId,
    assetId: PortalMediaAssetId,
    at: Date,
  ) => Promise<void>

  /** Sweep: taken-down assets whose object may still be in the store, oldest first. */
  listTakenDownWithObject: (limit: number) => Promise<readonly PortalMediaAsset[]>
  /**
   * Sweep: active assets created before `cutoff` that nothing refers to, oldest
   * first. "Nothing" means no Brand Profile or link in the working model and no
   * publication snapshot: snapshots are immutable and must keep verifying and
   * rendering, so an image one of them names is kept for as long as it exists.
   */
  listUnreferencedBefore: (
    cutoff: Date,
    limit: number,
  ) => Promise<readonly PortalMediaAsset[]>
  /**
   * Deletes the asset's row if it is still active, still older than `cutoff` and
   * still unreferenced, calling `removeObject` first, in the same transaction and
   * with the row locked: a writer attaching the asset at that moment waits for the
   * lock and then finds the row gone, and a failed removal keeps the row for the
   * next sweep. Returns whether the asset was discarded.
   */
  discardIfUnreferenced: (
    asset: PortalMediaAsset,
    cutoff: Date,
    removeObject: (objectKey: string) => Promise<void>,
  ) => Promise<boolean>
}>
