// Portal context — portal link Drizzle repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Every query filters by organization_id (tenant isolation).

import { eq, and, type SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalLinkCategories, portalLinks } from '#/shared/db/schema/portal.schema'
import type { PortalLinkRepository } from '../../application/ports/portal-link.repository'
import type { OrganizationId, PortalLinkCategoryId, PortalLinkId } from '#/shared/domain/ids'
import {
  categoryFromRow,
  categoryToRow,
  linkFromRow,
  linkToRow,
} from '../mappers/portal-link.mapper'

// ── Tenant-filter helpers ─────────────────────────────────────────

const catOrg = (orgId: OrganizationId): SQL<unknown> =>
  eq(portalLinkCategories.organizationId, orgId as unknown as string)

const catIdEq = (id: PortalLinkCategoryId): SQL<unknown> =>
  eq(portalLinkCategories.id, id as unknown as string)

const catPortal = (portalId: string): SQL<unknown> =>
  eq(portalLinkCategories.portalId, portalId)

const linkOrg = (orgId: OrganizationId): SQL<unknown> =>
  eq(portalLinks.organizationId, orgId as unknown as string)

const linkIdEq = (id: PortalLinkId): SQL<unknown> =>
  eq(portalLinks.id, id as unknown as string)

const linkCat = (categoryId: PortalLinkCategoryId): SQL<unknown> =>
  eq(portalLinks.categoryId, categoryId as unknown as string)

const linkPortal = (portalId: string): SQL<unknown> =>
  eq(portalLinks.portalId, portalId)

export const createPortalLinkRepository = (db: Database): PortalLinkRepository => ({
  listCategories: async (orgId, portalId) => {
    const rows = await db
      .select()
      .from(portalLinkCategories)
      .where(and(catOrg(orgId), catPortal(portalId)))
      .orderBy(portalLinkCategories.sortKey)
    return rows.map(categoryFromRow)
  },

  listLinks: async (orgId, categoryId) => {
    const rows = await db
      .select()
      .from(portalLinks)
      .where(and(linkOrg(orgId), linkCat(categoryId)))
      .orderBy(portalLinks.sortKey)
    return rows.map(linkFromRow)
  },

  listAllLinks: async (orgId, portalId) => {
    const rows = await db
      .select()
      .from(portalLinks)
      .where(and(linkOrg(orgId), linkPortal(portalId)))
      .orderBy(portalLinks.sortKey)
    return rows.map(linkFromRow)
  },

  insertCategory: async (orgId, cat) => {
    if (cat.organizationId !== orgId) {
      throw new Error('Tenant mismatch on category insert')
    }
    await db.insert(portalLinkCategories).values(categoryToRow(cat))
  },

  updateCategory: async (orgId, id, patch) => {
    const setValues: Record<string, unknown> = {}
    if (patch.title !== undefined) setValues.title = patch.title
    if (patch.sortKey !== undefined) setValues.sort_key = patch.sortKey as unknown as string
    if (patch.updatedAt !== undefined) setValues.updated_at = patch.updatedAt

    await db
      .update(portalLinkCategories)
      .set(setValues)
      .where(and(catOrg(orgId), catIdEq(id)))
  },

  deleteCategory: async (orgId, id) => {
    await db
      .delete(portalLinkCategories)
      .where(and(catOrg(orgId), catIdEq(id)))
  },

  reorderCategories: async (orgId, updates) => {
    for (const { id, sortKey } of updates) {
      await db
        .update(portalLinkCategories)
        .set({ sortKey, updatedAt: new Date() })
        .where(and(catOrg(orgId), catIdEq(id)))
    }
  },

  insertLink: async (orgId, link) => {
    if (link.organizationId !== orgId) {
      throw new Error('Tenant mismatch on link insert')
    }
    await db.insert(portalLinks).values(linkToRow(link))
  },

  updateLink: async (orgId, id, patch) => {
    const setValues: Record<string, unknown> = {}
    if (patch.label !== undefined) setValues.label = patch.label
    if (patch.url !== undefined) setValues.url = patch.url
    if (patch.iconKey !== undefined) setValues.icon_key = patch.iconKey
    if (patch.sortKey !== undefined) setValues.sort_key = patch.sortKey as unknown as string
    if (patch.updatedAt !== undefined) setValues.updated_at = patch.updatedAt

    await db
      .update(portalLinks)
      .set(setValues)
      .where(and(linkOrg(orgId), linkIdEq(id)))
  },

  deleteLink: async (orgId, id) => {
    await db
      .delete(portalLinks)
      .where(and(linkOrg(orgId), linkIdEq(id)))
  },

  reorderLinks: async (orgId, updates) => {
    for (const { id, sortKey } of updates) {
      await db
        .update(portalLinks)
        .set({ sortKey, updatedAt: new Date() })
        .where(and(linkOrg(orgId), linkIdEq(id)))
    }
  },

  findCategoryById: async (orgId, id) => {
    const rows = await db
      .select()
      .from(portalLinkCategories)
      .where(and(catOrg(orgId), catIdEq(id)))
      .limit(1)
    return rows[0] ? categoryFromRow(rows[0]) : null
  },

  findLinkById: async (orgId, id) => {
    const rows = await db
      .select()
      .from(portalLinks)
      .where(and(linkOrg(orgId), linkIdEq(id)))
      .limit(1)
    return rows[0] ? linkFromRow(rows[0]) : null
  },
})
