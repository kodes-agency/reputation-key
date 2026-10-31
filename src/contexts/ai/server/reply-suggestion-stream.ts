import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { reviewId } from '#/shared/domain/ids'
import { getAiRuntimeCapability } from '#/shared/ai-runtime-capability-contract'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { replyProgressResponse } from './reply-progress-stream.server'

const requestSchema = z
  .object({
    reviewId: z.uuid(),
    tone: z.enum(['professional', 'friendly', 'casual']),
    targetLanguage: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('property_default') }).strict(),
      z.object({ kind: z.literal('review_language') }).strict(),
    ]),
    idempotencyKey: z.uuid(),
    intent: z.enum(['explicit', 'background']).default('explicit'),
    trigger: z.enum(['draft', 'try_again', 'shorter', 'tone']).optional(),
    variation: z.number().int().nonnegative().safe().optional(),
    length: z.enum(['standard', 'short']).optional(),
    maxWords: z.number().int().min(8).max(80).optional(),
  })
  .strict()
  .refine((input) => input.maxWords === undefined || input.length === 'short')

/** Separate raw Response transport; v1's DTO, RPC result and provider bytes are unchanged. */
export const generateReplySuggestionStreamFn = createServerFn({ method: 'POST' })
  .validator(requestSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const ctx = await resolveTenantContext(await headersFromContext())
          const container = getContainer()
          const id = reviewId(data.reviewId)
          const current =
            await container.reviewPublicApi.aiReviewSource.readCurrentSource({
              organizationId: ctx.organizationId,
              reviewId: id,
            })
          if (current.status === 'not_found')
            throwContextError(
              'AiError',
              { code: 'not_found', message: 'Review not found' },
              404,
            )
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
          // No request parameter can activate the dark contract.
          if (
            getAiRuntimeCapability('reply_drafting').operationProfileVersion !==
            'reply-suggestion-v2'
          )
            return replyProgressResponse(
              async () => ({
                status: 'unavailable',
                code: 'policy_unavailable',
                retryAfterEpochMillis: null,
              }),
              data.intent,
            )
          const browserSignal = getRequest().signal
          return replyProgressResponse(
            (onProgress) =>
              container.aiPublicApi.generateReplySuggestion({
                ...data,
                reviewId: id,
                organizationId: ctx.organizationId,
                propertyId: current.source.propertyId,
                actorUserId: ctx.userId,
                expectedSourceEpoch: current.source.sourceEpoch,
                expectedSourceRevision: current.source.sourceRevision,
                expectedBaseReplyStateRevision: baseReplyStateRevision,
                onProgress,
              }),
            data.intent,
            browserSignal,
          )
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'POST',
      'ai.generateReplySuggestionStream',
    ),
  )
