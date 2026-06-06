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
import { timeRangePreset, type TimeRangePreset } from '../application/dto/dashboard.dto'
import { propertyId, portalId, userId } from '#/shared/domain/ids'
import { isDashboardError } from '../domain/errors'
import type { DashboardErrorCode } from '../domain/errors'
import { standardErrorStatus } from '#/shared/auth/error-status'
import { z } from 'zod/v4'

/** Local error constructor — server must not import domain error constructors. */
const makeDashboardError = (code: DashboardErrorCode, message: string) => ({
  _tag: 'DashboardError' as const,
  code,
  message,
})

export const staffDashboardErrorStatus = standardErrorStatus

const MS_PER_DAY = 86_400_000

function timeRangeToDates(preset: TimeRangePreset) {
  const now = new Date()
  if (preset === 'all') {
    return { startDate: new Date(0), endDate: now }
  }
  const days = preset === '7d' ? 7 : preset === '60d' ? 60 : preset === '90d' ? 90 : 30
  return {
    startDate: new Date(now.getTime() - days * MS_PER_DAY),
    endDate: now,
  }
}

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
