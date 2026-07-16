// Dashboard context — portal analytics server function
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'

import { requireAuthorized } from '#/shared/auth/authorization-policy'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getPortalAnalyticsDto } from '../application/dto/dashboard.dto'
export type { PortalAnalyticsData } from '../domain/types'
import { timeRangeToDates } from '../application/utils'
import { propertyId, portalId } from '#/shared/domain/ids'
import { isDashboardError } from '../domain/errors'
import type { DashboardErrorCode } from '../domain/errors'
import { standardErrorStatus as dashboardErrorStatus } from '#/shared/http/status'

/** Local error constructor — server must not import domain error constructors. */
const makeDashboardError = (code: DashboardErrorCode, message: string) => ({
  _tag: 'DashboardError' as const,
  code,
  message,
})

export const getPortalAnalyticsFn = createServerFn({ method: 'GET' })
  .inputValidator(getPortalAnalyticsDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const headers = await headersFromContext()
          const ctx = await resolveTenantContext(headers)
          requireAuthorized({ actor: ctx, action: 'dashboard.read' })
          const { useCases, clock, staffPublicApi } = getContainer()
          // D6-001: non-admin callers may only read their assigned properties.
          if (
            !(await isPropertyAccessibleForPermission(
              (orgId, uId, orgWide) =>
                staffPublicApi.getAccessiblePropertyIds(orgId, uId, orgWide),
              ctx,
              'dashboard.read',
              propertyId(data.propertyId),
            ))
          ) {
            throw makeDashboardError('forbidden', 'Property not assigned to caller')
          }
          const { startDate, endDate } = timeRangeToDates(data.timeRange, clock())

          return await useCases.getPortalAnalytics({
            organizationId: ctx.organizationId,
            propertyId: propertyId(data.propertyId),
            portalId: portalId(data.portalId),
            startDate,
            endDate,
            timeRange: data.timeRange,
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
