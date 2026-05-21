// Dashboard context — server functions
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { getDashboardDataDto, type TimeRangePreset } from '../application/dto/dashboard.dto'
import { propertyId, portalId } from '#/shared/domain/ids'

const MS_PER_DAY = 86_400_000

function timeRangeToDates(preset: TimeRangePreset) {
  const days = preset === '7d' ? 7 : preset === '90d' ? 90 : 30
  const now = new Date()
  return {
    startDate: new Date(now.getTime() - days * MS_PER_DAY),
    endDate: now,
  }
}

export const getDashboardDataFn = createServerFn({ method: 'GET' })
  .inputValidator(getDashboardDataDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { useCases } = getContainer()
        const { startDate, endDate } = timeRangeToDates(data.timeRange)

        return useCases.getDashboardData({
          organizationId: ctx.organizationId,
          propertyId: propertyId(data.propertyId),
          portalId: data.portalId ? portalId(data.portalId) : null,
          startDate,
          endDate,
        })
      },
      'GET',
      'dashboard.getDashboardData',
    ),
  )
