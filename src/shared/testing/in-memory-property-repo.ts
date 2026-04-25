// In-memory PropertyRepository fake — for use in use case tests.
// Implements the same port interface so use cases can't tell the difference.
// Extra test-only methods (seed, all) allow tests to set up state.

import type { PropertyRepository } from '#/contexts/property/application/ports/property.repository'
import type { Property } from '#/contexts/property/domain/types'
import type { OrganizationId } from '#/shared/domain/ids'

export type InMemoryPropertyRepo = PropertyRepository &
  Readonly<{
    seed: (properties: ReadonlyArray<Property>) => void
    all: () => ReadonlyArray<Property>
  }>

export const createInMemoryPropertyRepo = (): InMemoryPropertyRepo => {
  const store = new Map<string, Property>()

  const isAccessible = (orgId: OrganizationId, property: Property) =>
    property.organizationId === orgId && property.deletedAt === null

  return {
    findById: async (orgId, id) => {
      const property = store.get(id)
      return property && isAccessible(orgId, property) ? property : null
    },

    list: async (orgId) => [...store.values()].filter((p) => isAccessible(orgId, p)),

    slugExists: async (orgId, slug, excludeId) =>
      [...store.values()].some(
        (p) =>
          isAccessible(orgId, p) &&
          p.slug === slug &&
          (excludeId === undefined || p.id !== excludeId),
      ),

    insert: async (_orgId, property) => {
      store.set(property.id, property)
    },

    update: async (orgId, id, patch) => {
      const existing = store.get(id)
      if (!existing || !isAccessible(orgId, existing)) return
      store.set(id, { ...existing, ...patch })
    },

    softDelete: async (orgId, id) => {
      const existing = store.get(id)
      if (!existing || !isAccessible(orgId, existing)) return
      store.set(id, { ...existing, deletedAt: new Date(), updatedAt: new Date() })
    },

    // ── Test-only helpers ───────────────────────────────────────────

    seed: (properties) => {
      for (const p of properties) store.set(p.id, p)
    },

    all: () => [...store.values()],
  }
}
