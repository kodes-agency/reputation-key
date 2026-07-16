// Dashboard context — attention-signals server function.
// Per architecture: server functions are the HTTP entry points into a context.
// Resolves tenant context from the authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'

import { requireAuthorized } from '#/shared/auth/authorization-policy'
import { isPropertyAccessibleForPermission } from '#/shared/domain/property-access'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { getAuth } from '#/shared/auth/auth'
import { timeRangePreset } from '../application/dto/dashboard.dto'
import { timeRangeToDates } from '../application/utils'
import { propertyId } from '#/shared/domain/ids'
import { isDashboardError } from '../domain/errors'
import type { DashboardErrorCode } from '../domain/errors'
import { extractResponseSlaHours } from '#/shared/domain/response-sla'
import { standardErrorStatus } from '#/shared/http/status'

/** Local error constructor — server must not import domain error constructors. */
const makeDashboardError = (code: DashboardErrorCode, message: string) => ({
  _tag: 'DashboardError' as const,
  code,
  message,
})

export const attentionSignalsErrorStatus = standardErrorStatus

const getAttentionSignalsDto = z.object({
  propertyId: z.string().uuid(),
  timeRange: timeRangePreset.default('all'),
})

export const getAttentionSignalsFn = createServerFn({ method: 'GET' })
  .inputValidator(getAttentionSignalsDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const headers = await headersFromContext()
          const ctx = await resolveTenantContext(headers)
          // §9: the fleet route guard requires dashboard.fleet_read (PM+); the
          // server fn must match so Staff cannot reach the RPC directly. The
          // attention band carries the 'unanswered' signal (reviews with no
          // published reply past SLA) — a reply-derived aggregate Staff must
          // not see.
          requireAuthorized({ actor: ctx, action: 'dashboard.read' })
          requireAuthorized({ actor: ctx, action: 'dashboard.fleet_read' })
          // Resolve the org-level response SLA (defaults to 48h when unset/no org).
          const auth = getAuth()
          const org = await auth.api.getFullOrganization({ headers })
          const slaHours = extractResponseSlaHours(org)
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

          return await useCases.getAttentionSignals({
            organizationId: ctx.organizationId,
            propertyId: propertyId(data.propertyId),
            slaHours,
            startDate,
            endDate,
            timeRange: data.timeRange,
          })
        } catch (e) {
          if (isDashboardError(e))
            throwContextError('DashboardError', e, attentionSignalsErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'dashboard.getAttentionSignals',
    ),
  )
