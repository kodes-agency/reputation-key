import type { Database } from '#/shared/db'
import type { PublicPortalLookup } from '../../application/ports/public-portal-lookup.port'
import {
  portals,
  portalLinkCategories,
  portalLinks,
} from '#/shared/db/schema/portal.schema'
import { guestError } from '../../domain/errors'
import { eq, and } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'

export const createPublicPortalLookup = (db: Database): PublicPortalLookup => ({
  findBySlug: async (propertySlug: string, portalSlug: string) => {
    return trace('publicPortal.findBySlug', async () => {
      const portalRows = await db
        .select()
        .from(portals)
        .where(
          and(
            eq(
              portals.propertyId,
              sql`(SELECT id::text FROM properties WHERE slug = ${propertySlug} LIMIT 1)`,
            ),
            eq(portals.slug, portalSlug),
          ),
        )
        .limit(1)

      if (portalRows.length === 0) {
        return null
      }

      const portal = portalRows[0]

      // Check if portal is active
      if (!portal.isActive) {
        throw guestError('portal_inactive', 'Portal is inactive')
      }

      // Get org name via raw query
      const orgResult = await db.execute(
        sql`SELECT id, name FROM "organization" WHERE id = ${portal.organizationId} LIMIT 1`,
      )
      const org = orgResult.rows[0] as { id: string; name: string } | undefined

      if (!org) {
        return null
      }

      // Load link categories and links
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
        categories,
        links,
        organizationId: org.id,
        propertyId: portal.propertyId,
      }
    })
  },
})
