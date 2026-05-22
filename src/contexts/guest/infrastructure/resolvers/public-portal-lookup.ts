import type { Database } from '#/shared/db'
import type { PublicPortalLookup } from '../../application/ports/public-portal-lookup.port'
import {
  portals,
  portalLinkCategories,
  portalLinks,
} from '#/shared/db/schema/portal.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { guestError } from '../../domain/errors'
import { eq, and } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'

export const createPublicPortalLookup = (db: Database): PublicPortalLookup => ({
  // PUBLIC API — no organizationId scoping by design.
  // These resolvers serve unauthenticated guest requests where the
  // link/portal ID acts as a capability token (unguessable UUID).
  findBySlug: async (propertySlug: string, portalSlug: string) => {
    return trace('publicPortal.findBySlug', async () => {
      // Look up property by slug using Drizzle query builder
      const propertyRows = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.slug, propertySlug))
        .limit(1)

      if (propertyRows.length === 0) {
        return null
      }

      const propertyId = propertyRows[0].id

      const portalRows = await db
        .select()
        .from(portals)
        .where(and(eq(portals.propertyId, propertyId), eq(portals.slug, portalSlug)))
        .limit(1)

      if (portalRows.length === 0) {
        return null
      }

      const portal = portalRows[0]

      // Check if portal is active
      if (!portal.isActive) {
        throw guestError('portal_inactive', 'Portal is inactive')
      }

      // Raw SQL required — the "organization" table is managed by Better Auth CLI
      // and has no Drizzle schema definition in this codebase.
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
