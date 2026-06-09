// Review context — staff recent activity server function
// Returns the last N reviews for the staff member's property.
// Reviews are property-scoped (no portalId on reviews), so all property
// reviews are visible to any staff assigned to that property.

import { z } from 'zod/v4'
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { can } from '#/shared/domain/permissions'
import { getContainer } from '#/composition'
import { propertyId as toPropertyId } from '#/shared/domain/ids'
import type { StaffRecentReview } from '../application/public-api'

const staffRecentActivitySchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
})

export const getStaffRecentActivity = createServerFn({ method: 'GET' })
  .inputValidator(staffRecentActivitySchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'review.read')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No review read permission' },
            403,
          )
        }

        try {
          const container = getContainer()
          const propertyId = toPropertyId(data.propertyId)

          // Verify the staff member has assignments for this property via staff public API
          const assignedPortals = await container.staffPublicApi.getAssignedPortals(
            { userId: ctx.userId, propertyId },
            ctx,
          )

          if (assignedPortals.length === 0) {
            return { reviews: [] }
          }

          // F038: Push LIMIT + ORDER BY to SQL instead of pulling 500 rows and sorting in JS.
          const recentReviews = await container.reviewRepo.findByPropertyId(
            propertyId,
            ctx.organizationId,
            { limit: 5 },
          )

          const reviews: StaffRecentReview[] = recentReviews.map((r) => ({
            id: r.id as string,
            rating: r.rating,
            snippet: r.text ?? '',
            date: r.reviewedAt.toISOString(),
          }))

          return { reviews }
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'GET',
      'review.getStaffRecentActivity',
    ),
  )
