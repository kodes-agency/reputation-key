// In-memory GbpCacheRepository fake — for use in use case tests.
// Implements the same port interface so use cases can't tell the difference.

import type { GbpCacheRepository } from '#/contexts/integration/application/ports/gbp-cache.repository'
import type { GbpCacheEntry, GbpCacheDataType } from '#/contexts/integration/domain/types'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type InMemoryGbpCacheRepo = GbpCacheRepository &
  Readonly<{
    seed: (entries: ReadonlyArray<GbpCacheEntry>) => void
    all: () => ReadonlyArray<GbpCacheEntry>
    testSetConnectionForProperty: (connectionId: string, propertyId: string) => void
  }>

const compoundKey = (
  organizationId: OrganizationId,
  propertyId: PropertyId,
  dataType: GbpCacheDataType,
) => `${organizationId as string}:${propertyId as string}:${dataType}`

export const createInMemoryGbpCacheRepo = (): InMemoryGbpCacheRepo => {
  const store = new Map<string, GbpCacheEntry>()
  const connectionPropertyMap = new Map<string, string>()

  return {
    findByPropertyAndType: async (organizationId, propertyId, dataType) => {
      return store.get(compoundKey(organizationId, propertyId, dataType)) ?? null
    },

    upsert: async (entry) => {
      store.set(
        compoundKey(entry.organizationId, entry.propertyId, entry.dataType),
        entry,
      )
    },

    deleteByProperty: async (propertyId, _orgId) => {
      for (const [key, entry] of store.entries()) {
        if (entry.propertyId === propertyId) {
          store.delete(key)
        }
      }
    },

    deleteAllExpired: async () => {
      const now = new Date()
      let count = 0
      for (const [key, entry] of store.entries()) {
        if (entry.expiresAt < now) {
          store.delete(key)
          count++
        }
      }
      return count
    },

    deleteByConnectionId: async (connectionId, orgId) => {
      const propertyId = connectionPropertyMap.get(connectionId)
      if (!propertyId) return 0
      let count = 0
      for (const [key, entry] of store.entries()) {
        if (
          (entry.propertyId as string) === propertyId &&
          entry.organizationId === orgId
        ) {
          store.delete(key)
          count++
        }
      }
      return count
    },

    // ── Test-only helpers ───────────────────────────────────────────

    seed: (entries) => {
      for (const entry of entries) {
        store.set(
          compoundKey(entry.organizationId, entry.propertyId, entry.dataType),
          entry,
        )
      }
    },

    all: () => [...store.values()],

    testSetConnectionForProperty: (connectionId, propertyId) => {
      connectionPropertyMap.set(connectionId, propertyId)
    },
  }
}
