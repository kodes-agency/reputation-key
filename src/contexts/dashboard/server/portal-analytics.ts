// Dashboard context — portal analytics server function
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { can } from '#/shared/domain/permissions'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getPortalAnalyticsDto } from '../application/dto/dashboard.dto'
export type { PortalAnalyticsData } from '../domain/types'
import { timeRangeToDates } from '../application/utils'
import { propertyId, portalId } from '#/shared/domain/ids'
import { isDashboardError } from '../domain/errors'
import type { DashboardErrorCode } from '../domain/errors'
import { match } from 'ts-pattern'

/** Local error constructor — server must not import domain error constructors. */
const makeDashboardError = (code: DashboardErrorCode, message: string) => ({
  _tag: 'DashboardError' as const,
  code,
  message,
})

const dashboardErrorStatus = (code: DashboardErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with('not_found', () => 404)
    .with('invalid_input', () => 400)
    .exhaustive()

export const getPortalAnalyticsFn = createServerFn({ method: 'GET' })
  .inputValidator(getPortalAnalyticsDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const headers = await headersFromContext()
          const ctx = await resolveTenantContext(headers)
          if (!can(ctx.role, 'dashboard.read')) {
            throw makeDashboardError(
              'forbidden',
              'Insufficient permissions to view dashboard',
            )
          }
          const { useCases, clock } = getContainer()
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
