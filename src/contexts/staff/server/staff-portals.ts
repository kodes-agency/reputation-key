// Staff context — list staff portals server function
// Returns portals assigned to the authenticated staff member for a given property.
// Fan-out + filter + sort extracted into the listStaffPortals use case (D8-008).

import { z } from 'zod/v4'
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged } from '#/shared/auth/server-errors'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
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
        await requireExecutionAllowed({
          actor: ctx,
          action: 'staff_assignment.read',
          propertyId: data.propertyId,
        })

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
