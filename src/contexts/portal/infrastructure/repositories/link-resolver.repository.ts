// Portal context — link resolver Drizzle repository implementation
// Implements LinkResolverPort for resolving link details (used by guest context).

import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalLinks, portals } from '#/shared/db/schema/portal.schema'
import type { LinkResolverPort } from '../../application/ports/link-resolver.port'
import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'

export const createLinkResolverPort = (db: Database): LinkResolverPort => ({
  // PUBLIC API — no organizationId scoping by design.
  // These resolvers serve unauthenticated guest requests where the
  // link/portal ID acts as a capability token (unguessable UUID).
  resolveLinkById: async (linkId) => {
    return trace('portalLink.resolveLinkById', async () => {
      const result = await db
        .select({
          id: portalLinks.id,
          url: portalLinks.url,
          organizationId: portalLinks.organizationId,
          portalId: portalLinks.portalId,
          propertyId: portals.propertyId,
        })
        .from(portalLinks)
        .innerJoin(portals, eq(portalLinks.portalId, portals.id))
        .where(eq(portalLinks.id, linkId))
        .limit(1)

      if (result.length === 0) {
        return null
      }

      const row = result[0]
      return {
        id: row.id,
        url: row.url,
        organizationId: row.organizationId as OrganizationId,
        portalId: row.portalId as unknown as PortalId,
        propertyId: row.propertyId as unknown as PropertyId,
      }
    })
  },
})
