// Dashboard context — fleet-overview server function.
// Per architecture: server functions are the HTTP entry points into a context.
// Resolves tenant context from the authenticated session, NOT from client payload.
// Accessible properties are resolved server-side (role-aware) — never trusted from the client.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'

import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getAuth } from '#/shared/auth/auth'
import { timeRangePreset } from '../application/dto/dashboard.dto'
import { isDashboardError } from '../domain/errors'
import { extractResponseSlaHours } from '#/shared/domain/response-sla'
import { scopeForPermission } from '#/shared/domain/permissions'
import { checkScopedCapability } from '#/shared/auth/beta-capabilities'
import { standardErrorStatus as fleetOverviewErrorStatus } from '#/shared/http/status'

/** Local error constructor — server must not import domain error constructors. */

const getFleetOverviewDto = z.object({
  timeRange: timeRangePreset.default('30d'),
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
          // §9: the fleet route guard (_authenticated/dashboard.tsx) requires
          // dashboard.fleet_read (PM+); the server fn must match so Staff
          // (who hold dashboard.read but not fleet_read) cannot reach the RPC
          // directly and read cross-property reply-derived aggregates.
          await requireExecutionAllowed({ actor: ctx, action: 'dashboard.read' })
          await requireExecutionAllowed({ actor: ctx, action: 'dashboard.fleet_read' })

          // Resolve the org-level response SLA (defaults to 48h when unset/no org).
          const auth = getAuth()
          const org = await auth.api.getFullOrganization({ headers })
          const slaHours = extractResponseSlaHours(org)

          const { dashboardPublicApi } = getContainer()

          const capabilityScope = { organizationId: ctx.organizationId }
          return await dashboardPublicApi.getFleetOverview({
            organizationId: ctx.organizationId,
            scope: {
              userId: ctx.userId,
              organizationWide:
                scopeForPermission(ctx, 'dashboard.fleet_read') === 'organization',
            },
            portalReadEnabled: checkScopedCapability(capabilityScope, 'portal.read')
              .allowed,
            goalReadEnabled: checkScopedCapability(capabilityScope, 'goal.use').allowed,
            slaHours,
            timeRange: data.timeRange,
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
