// Dashboard context — staff dashboard server function
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'

import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { timeRangePreset } from '../application/dto/dashboard.dto'
import { propertyId, portalId, userId } from '#/shared/domain/ids'
import { isDashboardError } from '../domain/errors'
import { standardErrorStatus as staffDashboardErrorStatus } from '#/shared/http/status'
import { z } from 'zod/v4'
import { resolvePropertyPeriod } from './resolve-property-period'

/** Local error constructor — server must not import domain error constructors. */

const getStaffDashboardDataDto = z.object({
  propertyId: z.uuid(),
  portalId: z.uuid().optional(),
  timeRange: timeRangePreset.default('30d'),
})

export const getStaffDashboardDataFn = createServerFn({ method: 'GET' })
  .validator(getStaffDashboardDataDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const headers = await headersFromContext()
          const ctx = await resolveTenantContext(headers)
          await requireExecutionAllowed({
            actor: ctx,
            action: 'dashboard.read',
            propertyId: data.propertyId,
          })
          const { dashboardPublicApi, clock, propertyPublicApi } = getContainer()
          const pid = propertyId(data.propertyId)
          const { startDate, endDate, propertyTimezone } = await resolvePropertyPeriod(
            { propertyFacts: propertyPublicApi, clock },
            {
              organizationId: ctx.organizationId,
              propertyId: pid,
              timeRange: data.timeRange,
            },
          )

          return await dashboardPublicApi.getStaffDashboardData(
            {
              organizationId: ctx.organizationId,
              userId: userId(ctx.userId),
              propertyId: pid,
              portalId: data.portalId ? portalId(data.portalId) : undefined,
              startDate,
              endDate,
              timeRange: data.timeRange,
              propertyTimezone,
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
