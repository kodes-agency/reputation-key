// Staff context — list staff portals server function
// Returns portals assigned to the authenticated staff member for a given property.
// Used by the portal filter dropdown on the staff home page.

import { z } from 'zod/v4'
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { can } from '#/shared/domain/permissions'
import { getContainer } from '#/composition'
import { propertyId as toPropertyId } from '#/shared/domain/ids'

const listStaffPortalsSchema = z.object({
  propertyId: z.string().min(1, 'Property ID is required'),
})

export type StaffPortalEntry = {
  id: string
  name: string
}

export const listStaffPortals = createServerFn({ method: 'GET' })
  .inputValidator(listStaffPortalsSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'staff_assignment.read')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No staff assignment read permission' },
            403,
          )
        }

        const container = getContainer()
        const propertyId = toPropertyId(data.propertyId)

        // 1. Resolve assigned portal IDs for this staff member
        const portalIds = await container.useCases.getAssignedPortals(
          { userId: ctx.userId, propertyId },
          ctx,
        )

        if (portalIds.length === 0) {
          return { portals: [] as StaffPortalEntry[] }
        }

        // 2. Fetch portal details for each assigned portal
        const portals: StaffPortalEntry[] = []
        for (const pid of portalIds) {
          const portal = await container.portalRepo.findById(ctx.organizationId, pid)
          if (portal && portal.isActive) {
            portals.push({ id: portal.id as string, name: portal.name })
          }
        }

        // Sort alphabetically
        portals.sort((a, b) => a.name.localeCompare(b.name))

        return { portals }
      },
      'GET',
      'staff.listStaffPortals',
    ),
  )
