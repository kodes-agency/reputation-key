import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalGroups,
  portalLinkCategories,
  portalLinks,
  portals,
} from '#/shared/db/schema/portal.schema'
import {
  unbrand,
  type PortalGroupId,
  type PortalId,
  type PortalLinkCategoryId,
  type PortalLinkId,
} from '#/shared/domain/ids'

export type PortalManagementScope = Readonly<{
  organizationId: string
  propertyId: string
  portalId?: string
}>

export const createPortalScopeRepository = (db: Database) => ({
  resolvePortal: async (id: PortalId): Promise<PortalManagementScope | null> => {
    const [scope] = await db
      .select({
        organizationId: portals.organizationId,
        propertyId: portals.propertyId,
        portalId: portals.id,
      })
      .from(portals)
      .where(and(eq(portals.id, unbrand(id)), isNull(portals.deletedAt)))
      .limit(1)
    return scope ?? null
  },

  resolveGroup: async (id: PortalGroupId): Promise<PortalManagementScope | null> => {
    const [scope] = await db
      .select({
        organizationId: portalGroups.organizationId,
        propertyId: portalGroups.propertyId,
      })
      .from(portalGroups)
      .where(and(eq(portalGroups.id, unbrand(id)), isNull(portalGroups.deletedAt)))
      .limit(1)
    return scope ?? null
  },

  resolveCategory: async (
    id: PortalLinkCategoryId,
  ): Promise<PortalManagementScope | null> => {
    const [scope] = await db
      .select({
        organizationId: portalLinkCategories.organizationId,
        propertyId: portals.propertyId,
        portalId: portalLinkCategories.portalId,
      })
      .from(portalLinkCategories)
      .innerJoin(
        portals,
        and(
          eq(portals.organizationId, portalLinkCategories.organizationId),
          eq(portals.id, portalLinkCategories.portalId),
          isNull(portals.deletedAt),
        ),
      )
      .where(eq(portalLinkCategories.id, unbrand(id)))
      .limit(1)
    return scope ?? null
  },

  resolveLink: async (id: PortalLinkId): Promise<PortalManagementScope | null> => {
    const [scope] = await db
      .select({
        organizationId: portalLinks.organizationId,
        propertyId: portals.propertyId,
        portalId: portalLinks.portalId,
      })
      .from(portalLinks)
      .innerJoin(
        portals,
        and(
          eq(portals.organizationId, portalLinks.organizationId),
          eq(portals.id, portalLinks.portalId),
          isNull(portals.deletedAt),
        ),
      )
      .where(eq(portalLinks.id, unbrand(id)))
      .limit(1)
    return scope ?? null
  },

  listPortalPropertyIds: async (organizationId: string): Promise<readonly string[]> => {
    const rows = await db
      .selectDistinct({ propertyId: portals.propertyId })
      .from(portals)
      .where(and(eq(portals.organizationId, organizationId), isNull(portals.deletedAt)))
    return rows.map((row) => row.propertyId)
  },
})
