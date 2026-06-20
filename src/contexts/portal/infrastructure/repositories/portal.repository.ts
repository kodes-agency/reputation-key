// Portal context — Drizzle repository implementation
// Per architecture: factory function returning Readonly<{ method }>.
// Every query filters by organization_id AND deleted_at IS NULL via baseWhere().

import { and, eq, not, sql, inArray, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { baseWhere } from '#/shared/db/base-where'
import {
  portals,
  portalLinkCategories,
  portalLinks,
  portalGroupMembers,
} from '#/shared/db/schema/portal.schema'
import { properties } from '#/shared/db/schema/property.schema'
import type {
  PortalRepository,
  PublicPortalResult,
  ResolvePortalContextResult,
} from '../../application/ports/portal.repository'
import { portalFromRow, portalToRow } from '../mappers/portal.mapper'
import { portalError } from '../../domain/errors'
import {
  unbrand,
  type OrganizationId,
  type PropertyId,
  type PortalGroupId,
} from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

/** Mutable set-values type for Drizzle .set() — strips readonly from Portal fields. */
type SetValues = {
  name?: string
  slug?: string
  description?: string | null
  heroImageUrl?: string | null
  theme?: Record<string, unknown>
  smartRoutingEnabled?: boolean
  smartRoutingThreshold?: number
  isActive?: boolean
  updatedAt?: Date
  deletedAt?: Date | null
}

export const createPortalRepository = (db: Database): PortalRepository => ({
  findById: async (orgId, id) => {
    return trace('portal.findById', async () => {
      const rows = await db
        .select()
        .from(portals)
        .where(and(...baseWhere(portals, orgId), eq(portals.id, unbrand(id))))
        .limit(1)
      return rows[0] ? portalFromRow(rows[0]) : null
    })
  },

  findBySlug: async (orgId, slug) => {
    return trace('portal.findBySlug', async () => {
      const rows = await db
        .select()
        .from(portals)
        .where(and(...baseWhere(portals, orgId), eq(portals.slug, slug)))
        .limit(1)
      return rows[0] ? portalFromRow(rows[0]) : null
    })
  },

  list: async (orgId) => {
    return trace('portal.list', async () => {
      const rows = await db
        .select()
        .from(portals)
        .where(and(...baseWhere(portals, orgId)))
      return rows.map(portalFromRow)
    })
  },

  listByProperty: async (orgId, propertyId) => {
    return trace('portal.listByProperty', async () => {
      const rows = await db
        .select()
        .from(portals)
        .where(and(...baseWhere(portals, orgId), eq(portals.propertyId, propertyId)))
      return rows.map(portalFromRow)
    })
  },

  slugExists: async (orgId, propertyId, slug, excludeId) => {
    return trace('portal.slugExists', async () => {
      const conditions = [
        ...baseWhere(portals, orgId),
        eq(portals.propertyId, propertyId),
        eq(portals.slug, slug),
      ]
      if (excludeId) {
        conditions.push(not(eq(portals.id, unbrand(excludeId))))
      }
      const rows = await db
        .select({ id: portals.id })
        .from(portals)
        .where(and(...conditions))
        .limit(1)
      return rows.length > 0
    })
  },

  insert: async (orgId, portal) => {
    return trace('portal.insert', async () => {
      if (portal.organizationId !== orgId) {
        throw portalError('forbidden', 'Tenant mismatch on portal insert')
      }
      await db.insert(portals).values(portalToRow(portal))
    })
  },

  update: async (orgId, id, patch) => {
    return trace('portal.update', async () => {
      const setValues: SetValues = {}
      if (patch.updatedAt !== undefined) setValues.updatedAt = patch.updatedAt
      if (patch.name !== undefined) setValues.name = patch.name
      if (patch.slug !== undefined) setValues.slug = patch.slug
      if (patch.description !== undefined) setValues.description = patch.description
      if (patch.heroImageUrl !== undefined) setValues.heroImageUrl = patch.heroImageUrl
      if (patch.theme !== undefined)
        setValues.theme = patch.theme as Record<string, unknown>
      if (patch.smartRoutingEnabled !== undefined)
        setValues.smartRoutingEnabled = patch.smartRoutingEnabled
      if (patch.smartRoutingThreshold !== undefined)
        setValues.smartRoutingThreshold = patch.smartRoutingThreshold
      if (patch.isActive !== undefined) setValues.isActive = patch.isActive

      await db
        .update(portals)
        .set(setValues)
        .where(and(...baseWhere(portals, orgId), eq(portals.id, unbrand(id))))
    })
  },

  softDelete: async (orgId, id) => {
    return trace('portal.softDelete', async () => {
      const now = new Date()
      await db
        .update(portals)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(...baseWhere(portals, orgId), eq(portals.id, unbrand(id))))
    })
  },

  getPortalQrInfo: async (orgId, id) => {
    return trace('portal.getPortalQrInfo', async () => {
      const rows = await db
        .select({
          portalSlug: portals.slug,
          propertySlug: properties.slug,
        })
        .from(portals)
        .innerJoin(properties, eq(properties.id, portals.propertyId))
        .where(
          and(
            eq(portals.id, unbrand(id)),
            eq(portals.organizationId, unbrand(orgId)),
            isNull(portals.deletedAt),
          ),
        )
        .limit(1)
      if (rows.length === 0) return null

      return { slug: rows[0].portalSlug, propertySlug: rows[0].propertySlug }
    })
  },

  resolvePortalContext: async (portalIdParam) => {
    return trace('portal.resolvePortalContext', async () => {
      const rows = await db
        .select({
          organizationId: portals.organizationId,
          propertyId: portals.propertyId,
        })
        .from(portals)
        .where(eq(portals.id, unbrand(portalIdParam)))
        .limit(1)

      if (rows.length === 0) return null

      return {
        organizationId: rows[0].organizationId as OrganizationId,
        propertyId: rows[0].propertyId as PropertyId,
      } satisfies ResolvePortalContextResult
    })
  },

  findPublicPortalBySlug: async (propertySlug, portalSlug) => {
    return trace('portal.findPublicPortalBySlug', async () => {
      // 1. Find property by slug
      const propRows = await db
        .select({ id: properties.id })
        .from(properties)
        .where(
          and(eq(properties.slug, propertySlug), sql`${properties.deletedAt} IS NULL`),
        )
        .limit(1)
      if (propRows.length === 0) return null

      // 2. Find portal by propertyId + slug (exclude soft-deleted)
      const portalRows = await db
        .select()
        .from(portals)
        .where(
          and(
            eq(portals.propertyId, propRows[0].id),
            eq(portals.slug, portalSlug),
            isNull(portals.deletedAt),
          ),
        )
        .limit(1)
      if (portalRows.length === 0) return null

      const portal = portalRows[0]

      // 3. Check active
      if (!portal.isActive) {
        throw portalError('portal_inactive', 'Portal is inactive')
      }

      // 4. Load organization name
      const orgResult = await db.execute(
        sql`SELECT id, name FROM "organization" WHERE id = ${portal.organizationId} LIMIT 1`,
      )
      const org = orgResult.rows[0] as { id: string; name: string } | undefined
      if (!org) return null

      // 5. Load categories and links
      const categories = await db
        .select()
        .from(portalLinkCategories)
        .where(eq(portalLinkCategories.portalId, portal.id))
        .orderBy(portalLinkCategories.sortKey)

      const links = await db
        .select()
        .from(portalLinks)
        .where(eq(portalLinks.portalId, portal.id))
        .orderBy(portalLinks.sortKey)

      return {
        portal: {
          id: portal.id,
          name: portal.name,
          slug: portal.slug,
          description: portal.description,
          heroImageUrl: portal.heroImageUrl,
          theme: portal.theme as Record<string, string | number | boolean | null> | null,
          smartRoutingEnabled: portal.smartRoutingEnabled,
          smartRoutingThreshold: portal.smartRoutingThreshold,
          organizationName: org.name,
        },
        categories: categories.map((c) => ({
          id: c.id,
          title: c.title,
          sortKey: c.sortKey,
        })),
        links: links.map((l) => ({
          id: l.id,
          label: l.label,
          url: l.url,
          categoryId: l.categoryId,
          sortKey: l.sortKey,
        })),
        organizationId: org.id,
        propertyId: portal.propertyId,
      } satisfies PublicPortalResult
    })
  },

  findGroupIdsByPortalIds: async (orgId, portalIds) => {
    return trace('portal.findGroupIdsByPortalIds', async () => {
      if (portalIds.length === 0) return []

      const rows = await db
        .selectDistinct({ portalGroupId: portalGroupMembers.portalGroupId })
        .from(portalGroupMembers)
        .innerJoin(portals, eq(portals.id, portalGroupMembers.portalId))
        .where(
          and(
            ...baseWhere(portals, orgId),
            inArray(portals.id, [...portalIds] as string[]),
          ),
        )

      const groupIds: PortalGroupId[] = []
      for (const row of rows) {
        if (row.portalGroupId) {
          groupIds.push(row.portalGroupId as PortalGroupId)
        }
      }
      return groupIds
    })
  },
})
