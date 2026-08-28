// Dashboard context — portal analytics server function
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'

import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getPortalAnalyticsDto } from '../application/dto/dashboard.dto'
export type { PortalAnalyticsData } from '../domain/types'
import { propertyId, portalId } from '#/shared/domain/ids'
import { isDashboardError } from '../domain/errors'
import { standardErrorStatus as dashboardErrorStatus } from '#/shared/http/status'
import { assertDashboardPropertyAccessible } from './assert-property-access'
import { resolvePropertyPeriod } from './resolve-property-period'

export const getPortalAnalyticsFn = createServerFn({ method: 'GET' })
  .validator(getPortalAnalyticsDto)
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
          const { dashboardPublicApi, clock, staffPublicApi, propertyPublicApi } =
            getContainer()
          // D6-001: non-admin callers may only read their assigned properties.
          await assertDashboardPropertyAccessible(staffPublicApi, ctx, data.propertyId)
          const pid = propertyId(data.propertyId)
          const { startDate, endDate, propertyTimezone } = await resolvePropertyPeriod(
            { propertyFacts: propertyPublicApi, clock },
            {
              organizationId: ctx.organizationId,
              propertyId: pid,
              timeRange: data.timeRange,
            },
          )

          return await dashboardPublicApi.getPortalAnalytics({
            organizationId: ctx.organizationId,
            propertyId: pid,
            portalId: portalId(data.portalId),
            startDate,
            endDate,
            timeRange: data.timeRange,
            propertyTimezone,
          })
        } catch (e) {
          if (isDashboardError(e))
            throwContextError('DashboardError', e, dashboardErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'dashboard.getPortalAnalytics',
    ),
  )
