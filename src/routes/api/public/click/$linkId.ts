import { createFileRoute } from '@tanstack/react-router'
import { getContainer } from '#/composition'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'

export const Route = createFileRoute('/api/public/click/$linkId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { db, useCases } = getContainer()
        const { portalLinks, portals } = await import('#/shared/db/schema/portal.schema')
        const { eq } = await import('drizzle-orm')

        const result = await db
          .select({
            url: portalLinks.url,
            organizationId: portalLinks.organizationId,
            portalId: portalLinks.portalId,
            propertyId: portals.propertyId,
          })
          .from(portalLinks)
          .innerJoin(portals, eq(portalLinks.portalId, portals.id))
          .where(eq(portalLinks.id, params.linkId))
          .limit(1)

        if (result.length === 0) {
          return new Response('Link not found', { status: 404 })
        }

        const {
          url,
          organizationId: orgId,
          portalId: pId,
          propertyId: propId,
        } = result[0]

        // Track click (fire-and-forget)
        try {
          await useCases.trackReviewLinkClick({
            linkId: params.linkId,
            organizationId: organizationId(orgId),
            portalId: portalId(pId),
            propertyId: propertyId(propId),
          })
        } catch {
          // Silent failure — analytics
        }

        // Redirect to actual review URL
        return new Response(null, {
          status: 302,
          headers: { Location: url },
        })
      },
    },
  },
})
