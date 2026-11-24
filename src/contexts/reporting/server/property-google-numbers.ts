import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { withDashboard } from './dashboard-request.server'
import { propertyId } from '#/shared/domain/ids'
import { tracedHandler } from '#/shared/observability/traced-server-fn'

export const getPropertyGoogleNumbersFn = createServerFn({ method: 'GET' })
  .validator(z.strictObject({ propertyId: z.uuid() }))
  .handler(
    tracedHandler(
      async ({ data }) =>
        withDashboard(async (context) => {
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
        }),
      'GET',
      'dashboard.getPropertyGoogleNumbers',
    ),
  )
