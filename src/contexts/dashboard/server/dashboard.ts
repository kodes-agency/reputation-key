// Dashboard context — server functions
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { can } from '#/shared/domain/permissions'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
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

          const dashboard = await useCases.getDashboardData({
            organizationId: ctx.organizationId,
            propertyId: propertyId(data.propertyId),
            portalId: data.portalId ? portalId(data.portalId) : null,
            startDate,
            endDate,
            timeRange: data.timeRange,
          })

          // §9: reply-derived fields (replyPerformance aggregates + per-review
          // replyStatus) must not surface to roles lacking reply.manage (Staff).
          // dashboard.read is granted to Staff, but the Reply glossary restricts
          // reply state to PM+ roles. Zero the reply metrics and hide per-review
          // reply state so a Staff caller (via direct RPC) learns nothing about
          // the reply workflow. The UI is already gated by property.admin (PM+),
          // so this only affects direct RPC callers.
          if (!can(ctx.role, 'reply.manage')) {
            return {
              ...dashboard,
              replyPerformance: { replyRate: 0, avgReplyHours: null },
              recentReviews: dashboard.recentReviews.map((review) => ({
                ...review,
                replyStatus: 'none' as const,
              })),
            }
          }
          return dashboard
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
