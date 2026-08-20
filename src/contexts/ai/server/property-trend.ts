import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged } from '#/shared/auth/server-errors'
import { propertyId } from '#/shared/domain/ids'
import { tracedHandler } from '#/shared/observability/traced-server-fn'

const getPropertyAiTrendDto = z.object({ propertyId: z.uuid() })

export const getPropertyAiTrendFn = createServerFn({ method: 'GET' })
  .inputValidator(getPropertyAiTrendDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const id = propertyId(data.propertyId)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'ai.trends.read',
          propertyId: id,
        })
        try {
          return await getContainer().useCases.readPropertyAiTrend({
            organizationId: ctx.organizationId,
            propertyId: id,
            actorUserId: ctx.userId,
          })
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'GET',
      'ai.getPropertyTrend',
    ),
  )
