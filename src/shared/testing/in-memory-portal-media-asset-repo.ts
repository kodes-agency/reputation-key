// In-memory PortalMediaAssetRepository fake — for use in use case tests.

import type { PortalMediaAssetRepository } from '#/contexts/portal/application/ports/portal-media-asset.repository'
import type { PortalMediaAsset } from '#/contexts/portal/domain/portal-media-asset'

export type InMemoryPortalMediaAssetRepo = PortalMediaAssetRepository &
  Readonly<{
    seed: (assets: ReadonlyArray<PortalMediaAsset>) => void
    all: () => ReadonlyArray<PortalMediaAsset>
    /** Makes the next insert fail, to prove what a caller cleans up. */
    failNextInsert: (error: Error) => void
    /** Marks assets as referred to by a Brand Profile, link or snapshot. */
    markReferenced: (...assetIds: ReadonlyArray<string>) => void
  }>

export const createInMemoryPortalMediaAssetRepo = (): InMemoryPortalMediaAssetRepo => {
  const store = new Map<string, PortalMediaAsset>()
  const referenced = new Set<string>()
  let pendingFailure: Error | null = null

  const isCandidate = (asset: PortalMediaAsset, cutoff: Date) =>
    asset.status === 'active' &&
    asset.createdAt.getTime() < cutoff.getTime() &&
    !referenced.has(asset.id)
  const oldestFirst = (a: PortalMediaAsset, b: PortalMediaAsset) =>
    a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)

  return {
    insert: async (asset) => {
      if (pendingFailure) {
        const failure = pendingFailure
        pendingFailure = null
        throw failure
      }
      store.set(asset.id, asset)
    },
    findById: async (organizationId, assetId) => {
      const asset = store.get(assetId)
      return asset && asset.organizationId === organizationId ? asset : null
    },
    countActiveForProperty: async (organizationId, propertyId) =>
      [...store.values()].filter(
        (asset) =>
          asset.organizationId === organizationId &&
          asset.propertyId === propertyId &&
          asset.status === 'active',
      ).length,
    findForPublicRead: async (assetId) => store.get(assetId) ?? null,
    listServableIds: async (organizationId, propertyId, assetIds) =>
      assetIds.filter((id) => {
        const asset = store.get(id)
        return (
          asset?.organizationId === organizationId &&
          asset.propertyId === propertyId &&
          asset.status === 'active'
        )
      }),
    markTakenDown: async (organizationId, assetId, at) => {
      const asset = store.get(assetId)
      if (asset?.organizationId !== organizationId || asset.status !== 'active') {
        return null
      }
      const taken: PortalMediaAsset = { ...asset, status: 'taken_down', takenDownAt: at }
      store.set(assetId, taken)
      return taken
    },
    markObjectDeleted: async (organizationId, assetId, at) => {
      const asset = store.get(assetId)
      if (
        asset?.organizationId !== organizationId ||
        asset.status !== 'taken_down' ||
        asset.objectDeletedAt
      ) {
        return
      }
      store.set(assetId, { ...asset, objectDeletedAt: at })
    },
    listTakenDownWithObject: async (limit) =>
      [...store.values()]
        .filter((asset) => asset.status === 'taken_down' && !asset.objectDeletedAt)
        .sort(
          (a, b) =>
            (a.takenDownAt?.getTime() ?? 0) - (b.takenDownAt?.getTime() ?? 0) ||
            a.id.localeCompare(b.id),
        )
        .slice(0, limit),
    listUnreferencedBefore: async (cutoff, limit) =>
      [...store.values()]
        .filter((asset) => isCandidate(asset, cutoff))
        .sort(oldestFirst)
        .slice(0, limit),
    discardIfUnreferenced: async (asset, cutoff, removeObject) => {
      const current = store.get(asset.id)
      if (!current || !isCandidate(current, cutoff)) return false
      // Same order as the database: the object goes first, and a failure keeps the row.
      await removeObject(current.objectKey)
      store.delete(current.id)
      return true
    },
    seed: (assets) => {
      for (const asset of assets) store.set(asset.id, asset)
    },
    all: () => [...store.values()],
    failNextInsert: (error) => {
      pendingFailure = error
    },
    markReferenced: (...assetIds) => {
      for (const id of assetIds) referenced.add(id)
    },
  }
}
