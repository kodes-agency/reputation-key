import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { reviewId } from '#/shared/domain/ids'
import { tracedHandler } from '#/shared/observability/traced-server-fn'

function disableAiContentCaching(): void {
  setResponseHeader('Cache-Control', 'private, no-store, max-age=0')
  setResponseHeader('Pragma', 'no-cache')
  setResponseHeader('Expires', '0')
}

const generateReplySuggestionDto = z
  .object({
    reviewId: z.uuid(),
    tone: z.enum(['professional', 'friendly', 'casual']),
    targetLanguage: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('property_default') }).strict(),
      z.object({ kind: z.literal('review_language') }).strict(),
    ]),
    idempotencyKey: z.uuid(),
  })
  .strict()

export const generateReplySuggestionFn = createServerFn({ method: 'POST' })
  .validator(generateReplySuggestionDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const container = getContainer()
        try {
          disableAiContentCaching()
          const id = reviewId(data.reviewId)
          const current =
            await container.reviewPublicApi.aiReviewSource.readCurrentSource({
              organizationId: ctx.organizationId,
              reviewId: id,
            })
          if (current.status === 'not_found') {
            throwContextError(
              'AiError',
              { code: 'not_found', message: 'Review not found' },
              404,
            )
          }
          await requireExecutionAllowed({
            actor: ctx,
            action: 'ai.reply.generate',
            propertyId: current.source.propertyId,
          })
          const baseReplyStateRevision =
            await container.reviewPublicApi.aiReviewSource.readReplyStateRevision({
              organizationId: ctx.organizationId,
              reviewId: id,
            })
          return await container.aiPublicApi.generateReplySuggestion({
            organizationId: ctx.organizationId,
            propertyId: current.source.propertyId,
            reviewId: id,
            actorUserId: ctx.userId,
            tone: data.tone,
            targetLanguage: data.targetLanguage,
            idempotencyKey: data.idempotencyKey,
            expectedSourceEpoch: current.source.sourceEpoch,
            expectedSourceRevision: current.source.sourceRevision,
            expectedBaseReplyStateRevision: baseReplyStateRevision,
          })
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'POST',
      'ai.generateReplySuggestion',
    ),
  )
