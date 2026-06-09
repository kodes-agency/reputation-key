// Dashboard context — staff dashboard server function
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { can } from '#/shared/domain/permissions'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { timeRangePreset } from '../application/dto/dashboard.dto'
import { timeRangeToDates } from '../application/utils'
import { propertyId, portalId, userId } from '#/shared/domain/ids'
import { isDashboardError } from '../application/public-api'
import type { DashboardErrorCode } from '../application/public-api'
import { standardErrorStatus } from '#/shared/http/status'
import { z } from 'zod/v4'

/** Local error constructor — server must not import domain error constructors. */
const makeDashboardError = (code: DashboardErrorCode, message: string) => ({
  _tag: 'DashboardError' as const,
  code,
  message,
})

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
          const headers = headersFromContext()
          const ctx = await resolveTenantContext(headers)
          if (!can(ctx.role, 'dashboard.read')) {
            throw makeDashboardError(
              'forbidden',
              'Insufficient permissions to view dashboard',
            )
          }
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
