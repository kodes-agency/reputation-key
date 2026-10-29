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
import { GUEST_VOICE_RANGES } from '#/shared/dashboard-range'
import type { PropertyInsightsRange } from '../application/public-api'
import { isAiError } from '../domain/errors'

// The page's own vocabulary (`?range=`). The AI context counts days as numbers, so
// this function speaks that to it: the browser does not carry the translation.
const getPropertyInsightsDto = z.strictObject({
  propertyId: z.uuid(),
  range: z.enum(GUEST_VOICE_RANGES),
})

const INSIGHTS_RANGE = {
  auto: 'auto',
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '365d': 365,
  all: 'all',
} as const satisfies Record<(typeof GUEST_VOICE_RANGES)[number], PropertyInsightsRange>

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
            range: INSIGHTS_RANGE[data.range],
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
