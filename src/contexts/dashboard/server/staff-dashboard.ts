// Dashboard context — staff dashboard server function
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { timeRangePreset } from '../application/dto/dashboard.dto'
import { timeRangeToDates } from '../application/utils'
import { propertyId, portalId, userId } from '#/shared/domain/ids'
import { isDashboardError } from '../application/public-api'
import { standardErrorStatus } from '#/shared/http/status'
import { z } from 'zod/v4'

export const staffDashboardErrorStatus = standardErrorStatus

const getStaffDashboardDataDto = z.object({
  propertyId: z.string().uuid(),
  portalId: z.string().uuid().optional(),
  timeRange: timeRangePreset.default('all'),
})

export const getStaffDashboardDataFn = createServerFn({ method: 'GET' })
  .inputValidator(getStaffDashboardDataDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const headers = await headersFromContext()
          const ctx = await resolveTenantContext(headers)
          const { useCases } = getContainer()
          const { startDate, endDate } = timeRangeToDates(data.timeRange)

          return await useCases.getStaffDashboardData(
            {
              organizationId: ctx.organizationId,
              userId: userId(ctx.userId),
              propertyId: propertyId(data.propertyId),
              portalId: data.portalId ? portalId(data.portalId) : undefined,
              startDate,
              endDate,
              timeRange: data.timeRange,
            },
            ctx,
          )
        } catch (e) {
          if (isDashboardError(e))
            throwContextError('DashboardError', e, staffDashboardErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'dashboard.getStaffDashboardData',
    ),
  )
