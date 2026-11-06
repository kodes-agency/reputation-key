// Resolve tenant and accessible Properties server-side from the session and role;
// never trust client scope.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'

import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { isDashboardError } from '../domain/dashboard-errors'
import { scopeForPermission } from '#/shared/domain/permissions'
import { checkScopedCapability } from '#/shared/auth/beta-capabilities'
import { dashboardErrorStatus as fleetOverviewErrorStatus } from './dashboard-error-status'

const getFleetOverviewDto = z.object({
  cursor: z.string().min(1).max(512).optional(),
})

export const getFleetOverviewFn = createServerFn({ method: 'GET' })
  .validator(getFleetOverviewDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const headers = await headersFromContext()
          const ctx = await resolveTenantContext(headers)
          // Fleet attention includes Inbox work, so a reader needs both the
          // dashboard and fleet permissions before any cross-Property read.
          await requireExecutionAllowed({ actor: ctx, action: 'dashboard.read' })
          await requireExecutionAllowed({ actor: ctx, action: 'dashboard.fleet_read' })

          const { dashboardPublicApi } = getContainer()

          const capabilityScope = { organizationId: ctx.organizationId }
          return await dashboardPublicApi.getFleetOverview({
            organizationId: ctx.organizationId,
            scope: {
              userId: ctx.userId,
              organizationWide:
                scopeForPermission(ctx, 'dashboard.fleet_read') === 'organization',
            },
            goalReadEnabled: checkScopedCapability(capabilityScope, 'goal.use').allowed,
            cursor: data.cursor,
          })
        } catch (e) {
          if (isDashboardError(e))
            throwContextError('DashboardError', e, fleetOverviewErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'dashboard.getFleetOverview',
    ),
  )
