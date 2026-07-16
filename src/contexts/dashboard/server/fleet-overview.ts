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

import { requireAuthorized } from '#/shared/auth/authorization-policy'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getAuth } from '#/shared/auth/auth'
import { timeRangePreset } from '../application/dto/dashboard.dto'
import { timeRangeToDates } from '../application/utils'
import { isDashboardError } from '../domain/errors'
import { extractResponseSlaHours } from '#/shared/domain/response-sla'
import { standardErrorStatus } from '#/shared/http/status'

/** Local error constructor — server must not import domain error constructors. */

export const fleetOverviewErrorStatus = standardErrorStatus

const getFleetOverviewDto = z.object({
  // Operational default — the fleet overview answers "what needs my eye today".
  timeRange: timeRangePreset.default('30d'),
})

export const getFleetOverviewFn = createServerFn({ method: 'GET' })
  .inputValidator(getFleetOverviewDto)
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
          requireAuthorized({ actor: ctx, action: 'dashboard.read' })
          requireAuthorized({ actor: ctx, action: 'dashboard.fleet_read' })

          // Resolve the org-level response SLA (defaults to 48h when unset/no org).
          const auth = getAuth()
          const org = await auth.api.getFullOrganization({ headers })
          const slaHours = extractResponseSlaHours(org)

          const { useCases, clock } = getContainer()
          const { startDate, endDate } = timeRangeToDates(data.timeRange, clock())

          // Role-aware property enumeration (AccountAdmin sees all; managers/staff
          // see only assigned). Dashboard never queries property tables directly.
          const properties = await useCases.listProperties(ctx)

          return await useCases.getFleetOverview({
            organizationId: ctx.organizationId,
            properties: properties.map((p) => ({
              propertyId: p.id,
              name: p.name,
              slug: p.slug,
              timezone: p.timezone,
            })),
            slaHours,
            startDate,
            endDate,
            timeRange: data.timeRange,
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
