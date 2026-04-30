// In-memory PortalLinkRepository fake — for use in use case tests.
// Implements the same port interface so use cases can't tell the difference.

import type { PortalLinkRepository } from '#/contexts/portal/application/ports/portal-link.repository'
import type { PortalLinkCategory, PortalLink } from '#/contexts/portal/domain/types'

// fallow-ignore-next-line unused-type
export type InMemoryPortalLinkRepo = PortalLinkRepository &
  Readonly<{
    seedCategories: (categories: ReadonlyArray<PortalLinkCategory>) => void
    seedLinks: (links: ReadonlyArray<PortalLink>) => void
    allCategories: () => ReadonlyArray<PortalLinkCategory>
    allLinks: () => ReadonlyArray<PortalLink>
  }>

export const createInMemoryPortalLinkRepo = (): InMemoryPortalLinkRepo => {
  const categoryStore = new Map<string, PortalLinkCategory>()
  const linkStore = new Map<string, PortalLink>()

  return {
    listCategories: async (orgId, portalId) =>
      [...categoryStore.values()]
        .filter((c) => c.organizationId === orgId && c.portalId === portalId)
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey)),

    listLinks: async (orgId, categoryId) =>
      [...linkStore.values()]
        .filter((l) => l.organizationId === orgId && l.categoryId === categoryId)
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey)),

    listAllLinks: async (orgId, portalId) =>
      [...linkStore.values()]
        .filter((l) => l.organizationId === orgId && l.portalId === portalId)
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey)),

    insertCategory: async (_orgId, cat) => {
      categoryStore.set(cat.id as unknown as string, cat)
    },

    updateCategory: async (orgId, id, patch) => {
      const key = id as unknown as string
      const existing = categoryStore.get(key)
      if (!existing || existing.organizationId !== orgId) return
      categoryStore.set(key, { ...existing, ...patch })
    },

    deleteCategory: async (orgId, id) => {
      const key = id as unknown as string
      const existing = categoryStore.get(key)
      if (!existing || existing.organizationId !== orgId) return
      categoryStore.delete(key)
      // Cascade delete links in this category
      for (const [linkId, link] of linkStore) {
        if (link.categoryId === id) {
          linkStore.delete(linkId)
        }
      }
    },

    reorderCategories: async (orgId, updates) => {
      for (const { id, sortKey } of updates) {
        const key = id as unknown as string
        const existing = categoryStore.get(key)
        if (existing && existing.organizationId === orgId) {
          categoryStore.set(key, { ...existing, sortKey, updatedAt: new Date() })
        }
      }
    },

    insertLink: async (_orgId, link) => {
      linkStore.set(link.id as unknown as string, link)
    },

    updateLink: async (orgId, id, patch) => {
      const key = id as unknown as string
      const existing = linkStore.get(key)
      if (!existing || existing.organizationId !== orgId) return
      linkStore.set(key, { ...existing, ...patch })
    },

    deleteLink: async (orgId, id) => {
      const key = id as unknown as string
      const existing = linkStore.get(key)
      if (!existing || existing.organizationId !== orgId) return
      linkStore.delete(key)
    },

    reorderLinks: async (orgId, updates) => {
      for (const { id, sortKey } of updates) {
        const key = id as unknown as string
        const existing = linkStore.get(key)
        if (existing && existing.organizationId === orgId) {
          linkStore.set(key, { ...existing, sortKey, updatedAt: new Date() })
        }
      }
    },

    findCategoryById: async (orgId, id) => {
      const cat = categoryStore.get(id as unknown as string)
      return cat && cat.organizationId === orgId ? cat : null
    },

    findLinkById: async (orgId, id) => {
      const link = linkStore.get(id as unknown as string)
      return link && link.organizationId === orgId ? link : null
    },

    // ── Test-only helpers ───────────────────────────────────────────

    seedCategories: (categories) => {
      for (const c of categories) categoryStore.set(c.id as unknown as string, c)
    },

    seedLinks: (links) => {
      for (const l of links) linkStore.set(l.id as unknown as string, l)
    },

    allCategories: () => [...categoryStore.values()],

    allLinks: () => [...linkStore.values()],
  }
}
