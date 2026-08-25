// Dashboard context — server functions
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { canForContext } from '#/shared/domain/permissions'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getDashboardDataDto } from '../application/dto/dashboard.dto'
import { propertyId, portalId } from '#/shared/domain/ids'
import { isDashboardError } from '../domain/errors'
import { standardErrorStatus as dashboardErrorStatus } from '#/shared/http/status'
import { assertDashboardPropertyAccessible } from './assert-property-access'

import { resolvePropertyPeriod } from './resolve-property-period'

export const getDashboardDataFn = createServerFn({ method: 'GET' })
  .inputValidator(getDashboardDataDto)
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
          const { useCases, clock, staffPublicApi, propertyProcessingScopeApi } =
            getContainer()
          // D6-001: non-admin callers may only read their assigned properties.
          await assertDashboardPropertyAccessible(staffPublicApi, ctx, data.propertyId)
          const pid = propertyId(data.propertyId)
          const { startDate, endDate, propertyTimezone } = await resolvePropertyPeriod(
            { propertyFacts: propertyProcessingScopeApi, clock },
            {
              organizationId: ctx.organizationId,
              propertyId: pid,
              timeRange: data.timeRange,
            },
          )

          const dashboard = await useCases.getDashboardData({
            organizationId: ctx.organizationId,
            propertyId: pid,
            portalId: data.portalId ? portalId(data.portalId) : null,
            startDate,
            endDate,
            timeRange: data.timeRange,
            propertyTimezone,
          })

          // §9: reply-derived fields (replyPerformance aggregates + per-review
          // replyStatus) must not surface to roles lacking reply.manage (Staff).
          // dashboard.read is granted to Staff, but the Reply glossary restricts
          // reply state to PM+ roles. Zero the reply metrics and hide per-review
          // reply state so a Staff caller (via direct RPC) learns nothing about
          // the reply workflow. The UI is already gated by property.admin (PM+),
          // so this only affects direct RPC callers.
          if (!canForContext(ctx, 'reply.manage')) {
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
