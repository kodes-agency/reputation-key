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
  portalResponsibleManagers,
} from '#/shared/db/schema/portal.schema'
import type {
  PortalRepository,
  PublicPortalRepositoryResult,
  ResolvePortalContextResult,
} from '../../application/ports/portal.repository'
import { portalFromRow, portalToRow } from '../mappers/portal.mapper'
import type { Portal } from '../../domain/types'
import { portalError } from '../../domain/errors'
import {
  unbrand,
  type OrganizationId,
  type PropertyId,
  type PortalGroupId,
} from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import { isPubliclyAvailable } from '../../domain/portal-publication'

/** Mutable set-values type for Drizzle .set() — strips readonly from Portal fields. */
type SetValues = {
  name?: string
  slug?: string
  description?: string | null
  heroImageUrl?: string | null
  theme?: Record<string, unknown>
  privateFeedbackThreshold?: number
  publicationState?: Portal['publicationState']
  updatedAt?: Date
  deletedAt?: Date | null
}

async function loadPublicPortal(
  db: Database,
  portalRow: typeof portals.$inferSelect,
): Promise<PublicPortalRepositoryResult | null> {
  const portal = portalFromRow(portalRow)
  if (!isPubliclyAvailable(portal.publicationState)) {
    throw portalError('portal_inactive', 'Portal is unavailable')
  }
  const orgResult = await db.execute(
    sql`SELECT id, name FROM "organization" WHERE id = ${portalRow.organizationId} LIMIT 1`,
  )
  const org = orgResult.rows[0] as { id: string; name: string } | undefined
  if (!org) return null

  const [categories, links] = await Promise.all([
    db
      .select()
      .from(portalLinkCategories)
      .where(
        and(
          eq(portalLinkCategories.organizationId, portalRow.organizationId),
          eq(portalLinkCategories.portalId, portalRow.id),
        ),
      )
      .orderBy(portalLinkCategories.sortKey, portalLinkCategories.id),
    db
      .select()
      .from(portalLinks)
      .where(
        and(
          eq(portalLinks.organizationId, portalRow.organizationId),
          eq(portalLinks.portalId, portalRow.id),
        ),
      )
      .orderBy(portalLinks.sortKey, portalLinks.id),
  ])
  return {
    portal: {
      id: portalRow.id,
      name: portalRow.name,
      slug: portalRow.slug,
      description: portalRow.description,
      heroImageUrl: portalRow.heroImageUrl,
      theme: portalRow.theme as Record<string, string | number | boolean | null> | null,
      organizationName: org.name,
    },
    categories: categories.map((category) => ({
      id: category.id,
      title: category.title,
      sortKey: category.sortKey,
    })),
    links: links.map((link) => ({
      id: link.id,
      label: link.label,
      url: link.url,
      categoryId: link.categoryId,
      sortKey: link.sortKey,
    })),
    privateFeedbackThreshold: portal.privateFeedbackThreshold,
    organizationId: org.id,
    propertyId: portalRow.propertyId,
  }
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

  insert: async (orgId, portal, initialResponsibleManagerId) => {
    return trace('portal.insert', async () => {
      if (portal.organizationId !== orgId) {
        throw portalError('forbidden', 'Tenant mismatch on portal insert')
      }
      await db.transaction(async (tx) => {
        await tx.insert(portals).values(portalToRow(portal))
        if (initialResponsibleManagerId) {
          await tx.insert(portalResponsibleManagers).values({
            organizationId: orgId,
            propertyId: portal.propertyId,
            portalId: portal.id,
            userId: initialResponsibleManagerId,
            effectiveFrom: portal.createdAt,
            createdBy: initialResponsibleManagerId,
          })
        }
      })
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
      if (patch.privateFeedbackThreshold !== undefined)
        setValues.privateFeedbackThreshold = patch.privateFeedbackThreshold
      if (patch.publicationState !== undefined)
        setValues.publicationState = patch.publicationState

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

  resolvePortalContext: async (portalIdParam) => {
    return trace('portal.resolvePortalContext', async () => {
      const rows = await db
        .select({
          organizationId: portals.organizationId,
          propertyId: portals.propertyId,
        })
        .from(portals)
        .where(and(eq(portals.id, unbrand(portalIdParam)), isNull(portals.deletedAt)))
        .limit(1)

      if (rows.length === 0) return null

      return {
        organizationId: rows[0].organizationId as OrganizationId,
        propertyId: rows[0].propertyId as PropertyId,
      } satisfies ResolvePortalContextResult
    })
  },

  findPublicPortalById: async (orgId, portalIdParam) => {
    return trace('portal.findPublicPortalById', async () => {
      const [portal] = await db
        .select()
        .from(portals)
        .where(and(...baseWhere(portals, orgId), eq(portals.id, unbrand(portalIdParam))))
        .limit(1)
      return portal ? loadPublicPortal(db, portal) : null
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
