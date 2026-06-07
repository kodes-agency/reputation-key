// Review context — staff recent activity server function
// Returns the last N reviews for the staff member's property.
// Reviews are property-scoped (no portalId on reviews), so all property
// reviews are visible to any staff assigned to that property.

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

        // Verify the staff member has assignments for this property
        const assignedPortals = await container.useCases.getAssignedPortals(
          { userId: ctx.userId, propertyId },
          ctx,
        )

        if (assignedPortals.length === 0) {
          return { reviews: [] }
        }

        // Reviews are property-scoped — no portalId to filter by.
        // Staff assigned to any portal in the property can see all reviews.
        const allReviews = await container.reviewRepo.findByPropertyId(
          propertyId,
          ctx.organizationId,
        )

        // Sort by most recent and take last 5
        const sorted = [...allReviews].sort(
          (a, b) => b.reviewedAt.getTime() - a.reviewedAt.getTime(),
        )
        const recent = sorted.slice(0, 5)

        const reviews: StaffRecentReview[] = recent.map((r) => ({
          id: r.id as string,
          rating: r.rating,
          snippet: r.text ?? '',
          date: r.reviewedAt.toISOString(),
        }))

        return { reviews }
      },
      'GET',
      'review.getStaffRecentActivity',
    ),
  )
