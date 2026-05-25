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
import {
  getPortalAnalyticsDto,
  type TimeRangePreset,
} from '../application/dto/dashboard.dto'
export type { PortalAnalyticsData } from '../domain/types'
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

const MS_PER_DAY = 86_400_000

function timeRangeToDates(preset: TimeRangePreset) {
  const now = new Date()
  if (preset === 'all') {
    // No start bound — epoch captures all data
    return { startDate: new Date(0), endDate: now }
  }
  const days = preset === '7d' ? 7 : preset === '60d' ? 60 : preset === '90d' ? 90 : 30
  return {
    startDate: new Date(now.getTime() - days * MS_PER_DAY),
    endDate: now,
  }
}

export const getPortalAnalyticsFn = createServerFn({ method: 'GET' })
  .inputValidator(getPortalAnalyticsDto)
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
          catchUntagged(e)
        }
      },
      'GET',
      'dashboard.getPortalAnalytics',
    ),
  )
