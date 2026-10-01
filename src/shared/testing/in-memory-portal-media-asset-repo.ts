// In-memory PortalMediaAssetRepository fake — for use in use case tests.

import type { PortalMediaAssetRepository } from '#/contexts/portal/application/ports/portal-media-asset.repository'
import type { PortalMediaAsset } from '#/contexts/portal/domain/portal-media-asset'

export type InMemoryPortalMediaAssetRepo = PortalMediaAssetRepository &
  Readonly<{
    seed: (assets: ReadonlyArray<PortalMediaAsset>) => void
    all: () => ReadonlyArray<PortalMediaAsset>
    /** Makes the next insert fail, to prove what a caller cleans up. */
    failNextInsert: (error: Error) => void
  }>

export const createInMemoryPortalMediaAssetRepo = (): InMemoryPortalMediaAssetRepo => {
  const store = new Map<string, PortalMediaAsset>()
  let pendingFailure: Error | null = null

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
    seed: (assets) => {
      for (const asset of assets) store.set(asset.id, asset)
    },
    all: () => [...store.values()],
    failNextInsert: (error) => {
      pendingFailure = error
    },
  }
}
