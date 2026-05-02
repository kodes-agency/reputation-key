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

        const links = await db
          .select()
          .from(portalLinks)
          .where(eq(portalLinks.id, params.linkId))
          .limit(1)

        if (links.length === 0) {
          return new Response('Link not found', { status: 404 })
        }

        const link = links[0]

        // Fetch portal to get propertyId
        const portalResult = await db
          .select({ propertyId: portals.propertyId })
          .from(portals)
          .where(eq(portals.id, link.portalId))
          .limit(1)

        const propId = portalResult[0]?.propertyId ?? 'unknown'

        // Track click (fire-and-forget)
        try {
          await useCases.trackReviewLinkClick({
            linkId: params.linkId,
            organizationId: organizationId(link.organizationId),
            portalId: portalId(link.portalId),
            propertyId: propertyId(propId),
          })
        } catch {
          // Silent failure — analytics
        }

        // Redirect to actual review URL
        return new Response(null, {
          status: 302,
          headers: { Location: link.url },
        })
      },
    },
  },
})
