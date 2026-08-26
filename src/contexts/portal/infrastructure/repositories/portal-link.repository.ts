// Portal context — portal link Drizzle repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Every query filters by organization_id (tenant isolation).

import { eq, and, inArray, isNull, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalLinkCategories,
  portalLinks,
  portals,
} from '#/shared/db/schema/portal.schema'
import type { PortalLinkRepository } from '../../application/ports/portal-link.repository'
import type {
  OrganizationId,
  PortalId,
  PortalLinkCategoryId,
  PortalLinkId,
} from '#/shared/domain/ids'
import { unbrand } from '#/shared/domain/ids'
import {
  categoryFromRow,
  categoryToRow,
  linkFromRow,
  linkToRow,
} from '../mappers/portal-link.mapper'
import { portalError } from '../../domain/errors'
import { trace } from '#/shared/observability/trace'

// ── Tenant-filter helpers ─────────────────────────────────────────

const catOrg = (orgId: OrganizationId): SQL<unknown> =>
  eq(portalLinkCategories.organizationId, unbrand(orgId))

const catIdEq = (id: PortalLinkCategoryId): SQL<unknown> =>
  eq(portalLinkCategories.id, unbrand(id))

const catPortal = (portalId: PortalId): SQL<unknown> =>
  eq(portalLinkCategories.portalId, unbrand(portalId))

const linkOrg = (orgId: OrganizationId): SQL<unknown> =>
  eq(portalLinks.organizationId, unbrand(orgId))

const linkIdEq = (id: PortalLinkId): SQL<unknown> => eq(portalLinks.id, unbrand(id))

const linkCat = (categoryId: PortalLinkCategoryId): SQL<unknown> =>
  eq(portalLinks.categoryId, unbrand(categoryId))

const linkPortal = (portalId: PortalId): SQL<unknown> =>
  eq(portalLinks.portalId, unbrand(portalId))

export const createPortalLinkRepository = (db: Database): PortalLinkRepository => ({
  listCategories: async (orgId, portalId) => {
    return trace('portalLink.listCategories', async () => {
      const rows = await db
        .select()
        .from(portalLinkCategories)
        .where(and(catOrg(orgId), catPortal(portalId)))
        .orderBy(portalLinkCategories.sortKey)
      return rows.map(categoryFromRow)
    })
  },

  listLinks: async (orgId, portalId, categoryId) => {
    return trace('portalLink.listLinks', async () => {
      const rows = await db
        .select()
        .from(portalLinks)
        .where(and(linkOrg(orgId), linkPortal(portalId), linkCat(categoryId)))
        .orderBy(portalLinks.sortKey)
      return rows.map(linkFromRow)
    })
  },

  listAllLinks: async (orgId, portalId) => {
    return trace('portalLink.listAllLinks', async () => {
      const rows = await db
        .select()
        .from(portalLinks)
        .where(and(linkOrg(orgId), linkPortal(portalId)))
        .orderBy(portalLinks.sortKey)
      return rows.map(linkFromRow)
    })
  },

  insertCategory: async (orgId, cat) => {
    return trace('portalLink.insertCategory', async () => {
      if (cat.organizationId !== orgId) {
        throw portalError('forbidden', 'Tenant mismatch on category insert')
      }
      await db.insert(portalLinkCategories).values(categoryToRow(cat))
    })
  },

  updateCategory: async (orgId, portalId, id, patch) => {
    return trace('portalLink.updateCategory', async () => {
      const setValues: Partial<typeof portalLinkCategories.$inferInsert> = {}
      if (patch.title !== undefined) setValues.title = patch.title
      if (patch.sortKey !== undefined) setValues.sortKey = patch.sortKey
      if (patch.updatedAt !== undefined) setValues.updatedAt = patch.updatedAt

      await db
        .update(portalLinkCategories)
        .set(setValues)
        .where(and(catOrg(orgId), catPortal(portalId), catIdEq(id)))
    })
  },

  deleteCategory: async (orgId, portalId, id) => {
    return trace('portalLink.deleteCategory', async () => {
      await db
        .delete(portalLinkCategories)
        .where(and(catOrg(orgId), catPortal(portalId), catIdEq(id)))
    })
  },

  reorderCategories: async (orgId, portalId, updates) => {
    return trace('portalLink.reorderCategories', async () => {
      await db.transaction(async (tx) => {
        const ids = updates.map(({ id }) => unbrand(id))
        if (ids.length > 0) {
          const scoped = await tx
            .select({ id: portalLinkCategories.id })
            .from(portalLinkCategories)
            .where(
              and(
                catOrg(orgId),
                catPortal(portalId),
                inArray(portalLinkCategories.id, ids),
              ),
            )
          if (scoped.length !== ids.length) {
            throw portalError('forbidden', 'Portal category scope mismatch')
          }
        }
        for (const { id, sortKey } of updates) {
          await tx
            .update(portalLinkCategories)
            .set({ sortKey, updatedAt: new Date() })
            .where(and(catOrg(orgId), catPortal(portalId), catIdEq(id)))
        }
      })
    })
  },

  insertLink: async (orgId, link) => {
    return trace('portalLink.insertLink', async () => {
      if (link.organizationId !== orgId) {
        throw portalError('forbidden', 'Tenant mismatch on link insert')
      }
      await db.insert(portalLinks).values(linkToRow(link))
    })
  },

  updateLink: async (orgId, portalId, id, patch) => {
    return trace('portalLink.updateLink', async () => {
      const setValues: Partial<typeof portalLinks.$inferInsert> = {}
      if (patch.label !== undefined) setValues.label = patch.label
      if (patch.url !== undefined) setValues.url = patch.url
      if (patch.iconKey !== undefined) setValues.iconKey = patch.iconKey
      if (patch.sortKey !== undefined) setValues.sortKey = patch.sortKey
      if (patch.updatedAt !== undefined) setValues.updatedAt = patch.updatedAt

      await db
        .update(portalLinks)
        .set(setValues)
        .where(and(linkOrg(orgId), linkPortal(portalId), linkIdEq(id)))
    })
  },

  deleteLink: async (orgId, portalId, id) => {
    return trace('portalLink.deleteLink', async () => {
      await db
        .delete(portalLinks)
        .where(and(linkOrg(orgId), linkPortal(portalId), linkIdEq(id)))
    })
  },

  reorderLinks: async (orgId, portalId, categoryId, updates) => {
    return trace('portalLink.reorderLinks', async () => {
      await db.transaction(async (tx) => {
        const ids = updates.map(({ id }) => unbrand(id))
        if (ids.length > 0) {
          const scoped = await tx
            .select({ id: portalLinks.id })
            .from(portalLinks)
            .where(
              and(
                linkOrg(orgId),
                linkPortal(portalId),
                linkCat(categoryId),
                inArray(portalLinks.id, ids),
              ),
            )
          if (scoped.length !== ids.length) {
            throw portalError('forbidden', 'Portal link scope mismatch')
          }
        }
        for (const { id, sortKey } of updates) {
          await tx
            .update(portalLinks)
            .set({ sortKey, updatedAt: new Date() })
            .where(
              and(
                linkOrg(orgId),
                linkPortal(portalId),
                linkCat(categoryId),
                linkIdEq(id),
              ),
            )
        }
      })
    })
  },

  findCategoryById: async (orgId, id) => {
    return trace('portalLink.findCategoryById', async () => {
      const rows = await db
        .select()
        .from(portalLinkCategories)
        .where(and(catOrg(orgId), catIdEq(id)))
        .limit(1)
      return rows[0] ? categoryFromRow(rows[0]) : null
    })
  },

  findLinkById: async (orgId, id) => {
    return trace('portalLink.findLinkById', async () => {
      const rows = await db
        .select()
        .from(portalLinks)
        .where(and(linkOrg(orgId), linkIdEq(id)))
        .limit(1)
      return rows[0] ? linkFromRow(rows[0]) : null
    })
  },

  findCategoryCommandTarget: async (orgId, id) => {
    return trace('portalLink.findCategoryCommandTarget', async () => {
      const [row] = await db
        .select({ category: portalLinkCategories, portalUpdatedAt: portals.updatedAt })
        .from(portalLinkCategories)
        .innerJoin(
          portals,
          and(
            eq(portals.organizationId, portalLinkCategories.organizationId),
            eq(portals.id, portalLinkCategories.portalId),
            isNull(portals.deletedAt),
          ),
        )
        .where(and(catOrg(orgId), catIdEq(id)))
        .limit(1)
      return row
        ? {
            category: categoryFromRow(row.category),
            portalUpdatedAt: row.portalUpdatedAt,
          }
        : null
    })
  },

  findLinkCommandTarget: async (orgId, id) => {
    return trace('portalLink.findLinkCommandTarget', async () => {
      const [row] = await db
        .select({ link: portalLinks, portalUpdatedAt: portals.updatedAt })
        .from(portalLinks)
        .innerJoin(
          portals,
          and(
            eq(portals.organizationId, portalLinks.organizationId),
            eq(portals.id, portalLinks.portalId),
            isNull(portals.deletedAt),
          ),
        )
        .where(and(linkOrg(orgId), linkIdEq(id)))
        .limit(1)
      return row
        ? { link: linkFromRow(row.link), portalUpdatedAt: row.portalUpdatedAt }
        : null
    })
  },
})
