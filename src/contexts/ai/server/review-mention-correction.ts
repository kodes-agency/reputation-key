import { createServerFn } from '@tanstack/react-start'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { HTTP_STATUS } from '#/shared/http/status'
import { reviewId } from '#/shared/domain/ids'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { correctReviewMentionDto } from '../application/dto/review-mention-correction.dto'
import { isAiError } from '../domain/errors'

/**
 * "Not right?": a manager reading a review in the Inbox says what the AI got wrong about
 * it. Reading the review's current source is the authority for which analysis the
 * correction sits beside (a review that has changed since is another analysis, and the
 * use case answers not found); the Inbox's own write permission and the Property's scope
 * gate the call, and the AI context checks the reader for the Property again.
 */
export const correctReviewMentionFn = createServerFn({ method: 'POST' })
  .validator(correctReviewMentionDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const container = getContainer()
        try {
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
              HTTP_STATUS.NOT_FOUND,
            )
          }
          await requireExecutionAllowed({
            actor: ctx,
            action: 'inbox.write',
            propertyId: current.source.propertyId,
          })
          if (data.analysisSequence !== current.source.analysisSequence) {
            return { status: 'not_found' as const }
          }
          return await container.aiPublicApi.correctReviewMention({
            organizationId: ctx.organizationId,
            propertyId: current.source.propertyId,
            reviewId: id,
            sourceEpoch: current.source.sourceEpoch,
            sourceRevision: current.source.sourceRevision,
            analysisSequence: current.source.analysisSequence,
            mentionOrdinal: data.mentionOrdinal,
            action: data.action,
            actor: ctx,
          })
        } catch (error) {
          // The use case authorizes the reader for the Property itself.
          if (isAiError(error) && error.code === 'forbidden') {
            throwContextError('AiError', error, HTTP_STATUS.FORBIDDEN)
          }
          throw catchUntagged(error)
        }
      },
      'POST',
      'ai.correctReviewMention',
    ),
  )
