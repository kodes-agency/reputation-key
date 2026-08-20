import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged } from '#/shared/auth/server-errors'
import { propertyId } from '#/shared/domain/ids'
import { tracedHandler } from '#/shared/observability/traced-server-fn'

const getPropertyAiAggregatesDto = z.object({ propertyId: z.uuid() })

/**
 * The window is a fixed 30 PROPERTY-LOCAL days and is labelled as such in the
 * UI. It deliberately does not take the dashboard's `timeRange` preset: those
 * presets are UTC offsets from now, while these aggregates are keyed by the
 * property's local date, and `'all'` has no bounded local-date equivalent. A
 * knob that quietly reinterpreted `'all'` as ninety days would be worse than a
 * stated fixed window. A real period control is its own piece of work.
 */
const WINDOW_LOCAL_DAYS = 30

/**
 * Gated on `dashboard.read` rather than `ai.trends.read`. There is no
 * analysis-read permission, and `ai.trends.read` grants on `ai.detect_trends` --
 * a capability unrelated to the data being read here. The AI-specific gate
 * (merchant authorization enabled, `review_analysis` present, runtime
 * available) is enforced inside the use case, which is where the AI context
 * owns it.
 */
export const getPropertyAiAggregatesFn = createServerFn({ method: 'GET' })
  .inputValidator(getPropertyAiAggregatesDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const id = propertyId(data.propertyId)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'dashboard.read',
          propertyId: id,
        })
        try {
          return await getContainer().useCases.readPropertyAiAggregates({
            organizationId: ctx.organizationId,
            propertyId: id,
            actorUserId: ctx.userId,
            days: WINDOW_LOCAL_DAYS,
          })
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'GET',
      'ai.getPropertyAggregates',
    ),
  )
