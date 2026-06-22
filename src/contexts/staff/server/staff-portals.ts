// Staff context — list staff portals server function
// Returns portals assigned to the authenticated staff member for a given property.
// Fan-out + filter + sort extracted into the listStaffPortals use case (D8-008).

import { z } from 'zod/v4'
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { can } from '#/shared/domain/permissions'
import { getContainer } from '#/composition'
import { propertyId as toPropertyId } from '#/shared/domain/ids'

const listStaffPortalsSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
})

export const listStaffPortals = createServerFn({ method: 'GET' })
  .inputValidator(listStaffPortalsSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'staff_assignment.read')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No staff assignment read permission' },
            403,
          )
        }

        try {
          const { useCases } = getContainer()
          return await useCases.listStaffPortals(
            { userId: ctx.userId, propertyId: toPropertyId(data.propertyId) },
            ctx,
          )
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'GET',
      'staff.listStaffPortals',
    ),
  )
