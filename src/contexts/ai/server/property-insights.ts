import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { HTTP_STATUS } from '#/shared/http/status'
import { propertyId } from '#/shared/domain/ids'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { isAiError } from '../domain/errors'

const getPropertyInsightsDto = z.strictObject({
  propertyId: z.uuid(),
  range: z.union([z.literal(30), z.literal(90), z.literal(180), z.literal('all')]),
})

/**
 * Insights is a dashboard read. `dashboard.read` maps to the CORE
 * `dashboard.use` capability and preserves assigned-property scope. The
 * AI-specific review-analysis gate and epoch fences remain inside the AI use
 * case; using `ai.trends.read` here would incorrectly attach this report to the
 * controlled `ai.detect_trends` capability.
 */
export const getPropertyInsightsFn = createServerFn({ method: 'GET' })
  .validator(getPropertyInsightsDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const context = await resolveTenantContext(headers)
        const id = propertyId(data.propertyId)
        await requireExecutionAllowed({
          actor: context,
          action: 'dashboard.read',
          propertyId: id,
        })
        try {
          return await getContainer().aiPublicApi.readPropertyInsights({
            organizationId: context.organizationId,
            propertyId: id,
            actor: context,
            range: data.range,
          })
        } catch (error) {
          // The use case authorizes the reader for the Property itself.
          if (isAiError(error) && error.code === 'forbidden') {
            throwContextError('AiError', error, HTTP_STATUS.FORBIDDEN)
          }
          throw catchUntagged(error)
        }
      },
      'GET',
      'ai.getPropertyInsights',
    ),
  )
