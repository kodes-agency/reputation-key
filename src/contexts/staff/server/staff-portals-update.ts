// Staff context — staff portals update server function (split from staff-assignments.ts)
// Portal validation extracted into the updateStaffPortals use case (D8-001).
// This server fn resolves auth + delegates.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { portalId as toPortalId } from '#/shared/domain/ids'
import { propertyId as toPropertyId, userId as toUserId } from '#/shared/domain/ids'
import { isStaffError } from '../application/public-api'
import { staffErrorStatus } from './staff-shared'

// ── updateStaffPortals ─────────────────────────────────────────────

const updateStaffPortalsSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  propertyId: z.string().min(1, 'Property ID is required'),
  portalIds: z.array(z.string()).min(1, 'Select at least one portal'),
})

export const updateStaffPortals = createServerFn({ method: 'POST' })
  .inputValidator(updateStaffPortalsSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const result = await useCases.updateStaffPortals(
            {
              userId: toUserId(data.userId),
              propertyId: toPropertyId(data.propertyId),
              portalIds: data.portalIds.map((id) => toPortalId(id)),
            },
            ctx,
          )
          return result
        } catch (e) {
          if (isStaffError(e))
            throwContextError('StaffError', e, staffErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'staff.updateStaffPortals',
    ),
  )
