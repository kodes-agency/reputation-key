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
import { isDashboardError } from '../application/public-api'
import { standardErrorStatus as staffDashboardErrorStatus } from '#/shared/http/status'
import { z } from 'zod/v4'
import { resolvePropertyPeriod } from './resolve-property-period'

/** Local error constructor — server must not import domain error constructors. */

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
          await requireExecutionAllowed({
            actor: ctx,
            action: 'dashboard.read',
            propertyId: data.propertyId,
          })
          const { useCases, clock, propertyProcessingScopeApi } = getContainer()
          const pid = propertyId(data.propertyId)
          const { startDate, endDate, propertyTimezone } = await resolvePropertyPeriod(
            { propertyFacts: propertyProcessingScopeApi, clock },
            {
              organizationId: ctx.organizationId,
              propertyId: pid,
              timeRange: data.timeRange,
            },
          )

          return await useCases.getStaffDashboardData(
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
