// In-memory PortalLinkRepository fake — for use in use case tests.
// Implements the same port interface so use cases can't tell the difference.

import type { PortalLinkRepository } from '#/contexts/portal/application/ports/portal-link.repository'
import type { PortalLinkCategory, PortalLink } from '#/contexts/portal/domain/types'
import { portalError } from '#/contexts/portal/domain/errors'
import {
  resolveLinkTexts,
  type StoredPortalLinkText,
} from '#/contexts/portal/domain/portal-linktree'
import type { PortalLinkTextWrite } from '#/contexts/portal/application/ports/portal-command-store.port'
import type { GuestLocale } from '#/shared/domain/guest-locale'

export type InMemoryLinkTextWriter = Readonly<{ actorUserId: string; at: Date }>

export type InMemoryPortalLinkRepo = PortalLinkRepository &
  Readonly<{
    seedCategories: (categories: ReadonlyArray<PortalLinkCategory>) => void
    seedLinks: (links: ReadonlyArray<PortalLink>) => void
    allCategories: () => ReadonlyArray<PortalLinkCategory>
    allLinks: () => ReadonlyArray<PortalLink>
    /** Upsert link texts; returns the languages whose stored value actually changed. */
    saveTexts: (
      linkId: string,
      texts: ReadonlyArray<PortalLinkTextWrite>,
      writer: InMemoryLinkTextWriter,
    ) => ReadonlyArray<GuestLocale>
    /** Keep the primary-language text in step with a link label written by the legacy path. */
    syncPrimaryText: (
      linkId: string,
      locale: GuestLocale,
      label: string,
      writer: InMemoryLinkTextWriter,
    ) => void
    storedTexts: () => ReadonlyArray<StoredPortalLinkText>
    /** The Linktree title per language; null resets it. Stands in for the override rows. */
    saveLinktreeTitle: (
      portalId: string,
      locale: GuestLocale,
      title: string | null,
    ) => void
    linktreeTitles: (portalId: string) => Readonly<Partial<Record<GuestLocale, string>>>
  }>

export const createInMemoryPortalLinkRepo = (): InMemoryPortalLinkRepo => {
  const categoryStore = new Map<string, PortalLinkCategory>()
  const linkStore = new Map<string, PortalLink>()
  const textStore = new Map<string, StoredPortalLinkText>()
  const titleStore = new Map<string, string>()
  const textKey = (linkId: string, locale: string) => `${linkId}:${locale}`
  const dropTextsOf = (linkId: string) => {
    for (const [key, text] of textStore) if (text.linkId === linkId) textStore.delete(key)
  }

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

    listLinkTexts: async (orgId, portalId, primaryLocale) => {
      const links = [...linkStore.values()]
        .filter((l) => l.organizationId === orgId && l.portalId === portalId)
        .sort(
          (a, b) =>
            (categoryStore.get(String(a.categoryId))?.sortKey ?? '').localeCompare(
              categoryStore.get(String(b.categoryId))?.sortKey ?? '',
            ) || a.sortKey.localeCompare(b.sortKey),
        )
      return resolveLinkTexts({
        links: links.map((l) => ({ id: String(l.id), label: l.label })),
        texts: [...textStore.values()],
        primaryLocale,
      })
    },

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
          dropTextsOf(linkId)
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
      dropTextsOf(key)
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

    saveTexts: (linkId, texts, writer) =>
      texts.flatMap((text) => {
        const key = textKey(linkId, text.locale)
        const current = textStore.get(key)
        if (
          current &&
          current.label === text.label &&
          current.line === text.line &&
          current.provenance === text.provenance
        ) {
          return []
        }
        textStore.set(key, {
          linkId,
          locale: text.locale,
          label: text.label,
          line: text.line,
          provenance: text.provenance,
          version: (current?.version ?? 0) + 1,
          updatedBy: writer.actorUserId,
          updatedAt: writer.at,
        })
        return [text.locale]
      }),

    syncPrimaryText: (linkId, locale, label, writer) => {
      const key = textKey(linkId, locale)
      const current = textStore.get(key)
      if (current?.label === label) return
      textStore.set(key, {
        linkId,
        locale,
        label,
        line: current?.line ?? null,
        provenance: null,
        version: (current?.version ?? 0) + 1,
        updatedBy: writer.actorUserId,
        updatedAt: writer.at,
      })
    },

    storedTexts: () => [...textStore.values()],

    saveLinktreeTitle: (portalId, locale, title) => {
      const key = `${portalId}:${locale}`
      if (title === null) titleStore.delete(key)
      else titleStore.set(key, title)
    },

    linktreeTitles: (portalId) =>
      Object.fromEntries(
        [...titleStore.entries()].flatMap(([key, title]) =>
          key.startsWith(`${portalId}:`) ? [[key.slice(portalId.length + 1), title]] : [],
        ),
      ),
  }
}
