// In-memory PortalRepository fake — for use in use case tests.
// Implements the same port interface so use cases can't tell the difference.

import type { PortalRepository } from '#/contexts/portal/application/ports/portal.repository'
import type { Portal } from '#/contexts/portal/domain/types'
import type { OrganizationId } from '#/shared/domain/ids'

// fallow-ignore-next-line unused-type
export type InMemoryPortalRepo = PortalRepository &
  Readonly<{
    seed: (portals: ReadonlyArray<Portal>) => void
    all: () => ReadonlyArray<Portal>
  }>

export const createInMemoryPortalRepo = (): InMemoryPortalRepo => {
  const store = new Map<string, Portal>()

  const isAccessible = (orgId: OrganizationId, portal: Portal) =>
    portal.organizationId === orgId && portal.deletedAt === null

  return {
    findById: async (orgId, id) => {
      const portal = store.get(id)
      return portal && isAccessible(orgId, portal) ? portal : null
    },

    findBySlug: async (orgId, slug) => {
      for (const portal of store.values()) {
        if (isAccessible(orgId, portal) && portal.slug === slug) {
          return portal
        }
      }
      return null
    },

    list: async (orgId) => [...store.values()].filter((p) => isAccessible(orgId, p)),

    listByProperty: async (orgId, propertyId) =>
      [...store.values()].filter(
        (p) => isAccessible(orgId, p) && p.propertyId === propertyId,
      ),

    slugExists: async (orgId, slug, excludeId) =>
      [...store.values()].some(
        (p) =>
          isAccessible(orgId, p) &&
          p.slug === slug &&
          (excludeId === undefined || p.id !== excludeId),
      ),

    insert: async (_orgId, portal) => {
      store.set(portal.id, portal)
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

    seed: (portals) => {
      for (const p of portals) store.set(p.id, p)
    },

    all: () => [...store.values()],
  }
}
