import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { propertyId } from '#/shared/domain/ids'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { isDashboardError } from '../domain/dashboard-errors'
import { dashboardErrorStatus } from './dashboard-error-status'

export const getPropertyGoogleNumbersFn = createServerFn({ method: 'GET' })
  .validator(z.strictObject({ propertyId: z.uuid() }))
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const context = await resolveTenantContext(await headersFromContext())
          await requireExecutionAllowed({
            actor: context,
            action: 'dashboard.read',
            propertyId: data.propertyId,
          })
          return await getContainer().dashboardPublicApi.readPropertyGoogleNumbers(
            {
              organizationId: context.organizationId,
              propertyId: propertyId(data.propertyId),
            },
            context,
          )
        } catch (error) {
          if (isDashboardError(error))
            throwContextError('DashboardError', error, dashboardErrorStatus(error.code))
          throw catchUntagged(error)
        }
      },
      'GET',
      'dashboard.getPropertyGoogleNumbers',
    ),
  )
