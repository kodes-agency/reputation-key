// Review context — staff recent activity server function
// Returns the last N reviews for the staff member's assigned portals/property.
// Reviews are property-scoped; portal names are resolved from staff assignments.

import { z } from 'zod/v4'
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { can } from '#/shared/domain/permissions'
import { getContainer } from '#/composition'
import { propertyId as toPropertyId } from '#/shared/domain/ids'

const staffRecentActivitySchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
})

export type StaffRecentReview = {
  id: string
  rating: number
  snippet: string
  date: string
  portalName: string | null
}

export const getStaffRecentActivity = createServerFn({ method: 'GET' })
  .inputValidator(staffRecentActivitySchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'review.read')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No review read permission' },
            403,
          )
        }

        const container = getContainer()
        const propertyId = toPropertyId(data.propertyId)

        // Resolve assigned portal IDs for this staff member
        let portalNames: string[] = []
        try {
          const portalIds = await container.useCases.getAssignedPortals(
            { userId: ctx.userId, propertyId },
            ctx,
          )

          // Fetch portal names
          const names: string[] = []
          for (const pid of portalIds) {
            const portal = await container.portalRepo.findById(ctx.organizationId, pid)
            if (portal && portal.isActive) {
              names.push(portal.name)
            }
          }
          portalNames = names
        } catch {
          // If we can't resolve portals, continue with property-scoped reviews
        }

        // Get all reviews for this property
        const allReviews = await container.reviewRepo.findByPropertyId(
          propertyId,
          ctx.organizationId,
        )

        // Sort by most recent and take last 5
        const sorted = [...allReviews].sort(
          (a, b) => b.reviewedAt.getTime() - a.reviewedAt.getTime(),
        )
        const recent = sorted.slice(0, 5)

        const portalName = portalNames.length > 0 ? portalNames.join(', ') : null

        const reviews: StaffRecentReview[] = recent.map((r) => ({
          id: r.id as string,
          rating: r.rating,
          snippet: r.text ?? '',
          date: r.reviewedAt.toISOString(),
          portalName,
        }))

        return { reviews }
      },
      'GET',
      'review.getStaffRecentActivity',
    ),
  )
