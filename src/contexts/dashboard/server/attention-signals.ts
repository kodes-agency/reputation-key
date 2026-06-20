// Dashboard context — attention-signals server function.
// Per architecture: server functions are the HTTP entry points into a context.
// Resolves tenant context from the authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { can } from '#/shared/domain/permissions'
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
          if (!can(ctx.role, 'dashboard.read')) {
            throw makeDashboardError(
              'forbidden',
              'Insufficient permissions to view dashboard',
            )
          }
          // Resolve the org-level response SLA (defaults to 48h when unset/no org).
          const auth = getAuth()
          const org = await auth.api.getFullOrganization({ headers })
          const slaHours = extractResponseSlaHours(org)
          const { useCases, clock } = getContainer()
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
