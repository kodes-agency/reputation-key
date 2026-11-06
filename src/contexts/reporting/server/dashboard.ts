// Resolve tenant scope from the authenticated session, never the client payload.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getDashboardDataDto } from '../application/dto/dashboard.dto'
import { propertyId, portalId } from '#/shared/domain/ids'
import { isDashboardError } from '../domain/dashboard-errors'
import { dashboardErrorStatus } from './dashboard-error-status'

import { resolvePropertyPeriod } from './resolve-property-period'

/** Property page projection: Dashboard and attention share one KPI snapshot. */
export const getPropertyOverviewFn = createServerFn({ method: 'GET' })
  .validator(getDashboardDataDto)
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
          await requireExecutionAllowed({
            actor: ctx,
            action: 'dashboard.fleet_read',
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

          return await dashboardPublicApi.getPropertyOverview(
            {
              organizationId: ctx.organizationId,
              propertyId: pid,
              portalId: data.portalId ? portalId(data.portalId) : null,
              startDate,
              endDate,
              timeRange: data.timeRange,
              propertyTimezone,
            },
            ctx,
          )
        } catch (e) {
          if (isDashboardError(e))
            throwContextError('DashboardError', e, dashboardErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'dashboard.getPropertyOverview',
    ),
  )
