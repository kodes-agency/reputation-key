// Review context — staff recent activity server function
// Returns the last N reviews for the staff member's property.
// Reviews are property-scoped (no portalId on reviews), so all property
// reviews are visible to any staff assigned to that property.

import { z } from 'zod/v4'
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged } from '#/shared/auth/server-errors'
import { requireAuthorized } from '#/shared/auth/authorization-policy'
import { getContainer } from '#/composition'
import { propertyId as toPropertyId } from '#/shared/domain/ids'

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
        requireAuthorized({ actor: ctx, action: 'review.read' })

        try {
          const container = getContainer()
          const propertyId = toPropertyId(data.propertyId)

          const reviews = await container.useCases.getStaffRecentActivity(
            { propertyId },
            ctx,
          )

          return { reviews }
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'GET',
      'review.getStaffRecentActivity',
    ),
  )
