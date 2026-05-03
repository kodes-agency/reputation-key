import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portals } from '#/shared/db/schema/portal.schema'
import type { PortalContextResolver } from '../../application/ports/portal-context-resolver.port'
import type { OrganizationId, PropertyId, PortalId } from '#/shared/domain/ids'

export const createPortalContextResolver = (db: Database): PortalContextResolver => ({
  resolve: async (portalId: PortalId) => {
    const row = await db
      .select({
        organizationId: portals.organizationId,
        propertyId: portals.propertyId,
      })
      .from(portals)
      .where(eq(portals.id, portalId as unknown as string))
      .limit(1)

    if (row.length === 0) return null

    return {
      organizationId: row[0].organizationId as OrganizationId,
      propertyId: row[0].propertyId as PropertyId,
    }
  },
})
