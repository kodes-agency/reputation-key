// Dashboard context — server functions
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { can } from '#/shared/domain/permissions'
import { isPropertyAccessible } from '#/shared/domain/property-access'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getDashboardDataDto } from '../application/dto/dashboard.dto'
import { propertyId, portalId } from '#/shared/domain/ids'
import { isDashboardError } from '../domain/errors'
import type { DashboardErrorCode } from '../domain/errors'
import { standardErrorStatus } from '#/shared/http/status'

/** Local error constructor — server must not import domain error constructors. */
const makeDashboardError = (code: DashboardErrorCode, message: string) => ({
  _tag: 'DashboardError' as const,
  code,
  message,
})

import { timeRangeToDates } from '../application/utils'

export const dashboardErrorStatus = standardErrorStatus

export const getDashboardDataFn = createServerFn({ method: 'GET' })
  .inputValidator(getDashboardDataDto)
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
          const { useCases, clock, staffPublicApi } = getContainer()
          // D6-001: non-admin callers may only read their assigned properties.
          if (
            ctx.role !== 'AccountAdmin' &&
            !(await isPropertyAccessible(
              (orgId, uId, role) =>
                staffPublicApi.getAccessiblePropertyIds(orgId, uId, role),
              ctx.organizationId,
              ctx.userId,
              ctx.role,
              propertyId(data.propertyId),
            ))
          ) {
            throw makeDashboardError('forbidden', 'Property not assigned to caller')
          }
          const { startDate, endDate } = timeRangeToDates(data.timeRange, clock())

          return await useCases.getDashboardData({
            organizationId: ctx.organizationId,
            propertyId: propertyId(data.propertyId),
            portalId: data.portalId ? portalId(data.portalId) : null,
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
      'dashboard.getDashboardData',
    ),
  )
