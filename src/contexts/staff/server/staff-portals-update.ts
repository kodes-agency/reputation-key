// Staff context — staff portals update server function (split from staff-assignments.ts)

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { HTTP_STATUS } from '#/shared/http/status'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { portalId as toPortalId } from '#/shared/domain/ids'
import { propertyId as toPropertyId, userId as toUserId } from '#/shared/domain/ids'
import { isStaffError } from '../application/public-api'
import { staffErrorStatus } from './staff-assignments'

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
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

        // F058: Portal validation moved inside try/catch below to prevent unhandled errors
        // F057 NOTE: Cross-context import of portalRepo is acceptable here — staff context
        // needs to verify portal ownership before updating assignments.
        try {
          // Validate portalIds belong to the property
          const container = getContainer()
          const propertyPortals = await container.portalRepo.listByProperty(
            ctx.organizationId,
            data.propertyId,
          )
          const validPortalIds = new Set(propertyPortals.map((p) => p.id))
          const invalidPortalIds = data.portalIds
            .map((id) => toPortalId(id))
            .filter((id) => !validPortalIds.has(id))
          if (invalidPortalIds.length > 0) {
            throwContextError(
              'StaffError',
              {
                code: 'invalid_input',
                message: `Portals not in property: ${invalidPortalIds.join(', ')}`,
              },
              HTTP_STATUS.BAD_REQUEST,
            )
          }

          const { useCases } = container
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
