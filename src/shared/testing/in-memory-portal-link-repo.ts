// In-memory PortalLinkRepository fake — for use in use case tests.
// Implements the same port interface so use cases can't tell the difference.

import type { PortalLinkRepository } from '#/contexts/portal/application/ports/portal-link.repository'
import type { PortalLinkCategory, PortalLink } from '#/contexts/portal/domain/types'
import { portalError } from '#/contexts/portal/domain/errors'

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

    listLinks: async (orgId, portalId, categoryId) =>
      [...linkStore.values()]
        .filter(
          (l) =>
            l.organizationId === orgId &&
            l.portalId === portalId &&
            l.categoryId === categoryId,
        )
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey)),

    listAllLinks: async (orgId, portalId) =>
      [...linkStore.values()]
        .filter((l) => l.organizationId === orgId && l.portalId === portalId)
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey)),

    insertCategory: async (_orgId, cat) => {
      categoryStore.set(String(cat.id), cat)
    },

    updateCategory: async (orgId, portalId, id, patch) => {
      const key = String(id)
      const existing = categoryStore.get(key)
      if (
        !existing ||
        existing.organizationId !== orgId ||
        existing.portalId !== portalId
      )
        return
      categoryStore.set(key, { ...existing, ...patch })
    },

    deleteCategory: async (orgId, portalId, id) => {
      const key = String(id)
      const existing = categoryStore.get(key)
      if (
        !existing ||
        existing.organizationId !== orgId ||
        existing.portalId !== portalId
      )
        return
      categoryStore.delete(key)
      for (const [linkId, link] of linkStore) {
        if (link.categoryId === id && link.portalId === portalId) {
          linkStore.delete(linkId)
        }
      }
    },

    reorderCategories: async (orgId, portalId, updates) => {
      const categories = updates.map(({ id }) => categoryStore.get(String(id)))
      if (
        categories.some(
          (category) =>
            !category ||
            category.organizationId !== orgId ||
            category.portalId !== portalId,
        )
      ) {
        throw portalError('forbidden', 'Portal category scope mismatch')
      }
      for (const { id, sortKey } of updates) {
        const key = String(id)
        const existing = categoryStore.get(key)!
        categoryStore.set(key, { ...existing, sortKey, updatedAt: new Date() })
      }
    },

    insertLink: async (_orgId, link) => {
      linkStore.set(String(link.id), link)
    },

    updateLink: async (orgId, portalId, id, patch) => {
      const key = String(id)
      const existing = linkStore.get(key)
      if (
        !existing ||
        existing.organizationId !== orgId ||
        existing.portalId !== portalId
      )
        return
      linkStore.set(key, { ...existing, ...patch })
    },

    deleteLink: async (orgId, portalId, id) => {
      const key = String(id)
      const existing = linkStore.get(key)
      if (
        !existing ||
        existing.organizationId !== orgId ||
        existing.portalId !== portalId
      )
        return
      linkStore.delete(key)
    },

    reorderLinks: async (orgId, portalId, categoryId, updates) => {
      const links = updates.map(({ id }) => linkStore.get(String(id)))
      if (
        links.some(
          (link) =>
            !link ||
            link.organizationId !== orgId ||
            link.portalId !== portalId ||
            link.categoryId !== categoryId,
        )
      ) {
        throw portalError('forbidden', 'Portal link scope mismatch')
      }
      for (const { id, sortKey } of updates) {
        const key = String(id)
        const existing = linkStore.get(key)!
        linkStore.set(key, { ...existing, sortKey, updatedAt: new Date() })
      }
    },

    findCategoryById: async (orgId, id) => {
      const cat = categoryStore.get(String(id))
      return cat && cat.organizationId === orgId ? cat : null
    },

    findLinkById: async (orgId, id) => {
      const link = linkStore.get(String(id))
      return link && link.organizationId === orgId ? link : null
    },

    findCategoryCommandTarget: async (orgId, id) => {
      const category = categoryStore.get(String(id))
      return category && category.organizationId === orgId
        ? { category, portalUpdatedAt: null }
        : null
    },

    findLinkCommandTarget: async (orgId, id) => {
      const link = linkStore.get(String(id))
      return link && link.organizationId === orgId
        ? { link, portalUpdatedAt: null }
        : null
    },

    // ── Test-only helpers ───────────────────────────────────────────

    seedCategories: (categories) => {
      for (const c of categories) categoryStore.set(String(c.id), c)
    },

    seedLinks: (links) => {
      for (const l of links) linkStore.set(String(l.id), l)
    },

    allCategories: () => [...categoryStore.values()],

    allLinks: () => [...linkStore.values()],
  }
}
