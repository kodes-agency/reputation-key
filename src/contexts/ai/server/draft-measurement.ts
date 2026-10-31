import { catchUntagged } from '#/shared/auth/server-errors'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { reviewId } from '#/shared/domain/ids'
import { tracedHandler } from '#/shared/observability/traced-server-fn'

export const recordDraftMeasurementFn = createServerFn({ method: 'POST' })
  .validator(
    z
      .object({
        reviewId: z.uuid(),
        generationId: z.uuid(),
        baseReplyRevision: z.number().int().nonnegative().safe(),
        event: z.enum([
          'shown',
          'dismissed',
          'superseded',
          'draft',
          'try_again',
          'shorter',
          'tone',
        ]),
      })
      .strict(),
  )
  .handler(
    tracedHandler(
      async ({ data }) => {
        try {
          const ctx = await resolveTenantContext(await headersFromContext())
          const container = getContainer()
          const current =
            await container.reviewPublicApi.aiReviewSource.readCurrentSource({
              organizationId: ctx.organizationId,
              reviewId: reviewId(data.reviewId),
            })
          if (current.status === 'not_found') return
          await requireExecutionAllowed({
            actor: ctx,
            action: 'reply.manage',
            propertyId: current.source.propertyId,
          })
          await container.aiPublicApi.recordDraftMeasurement(
            {
              organizationId: ctx.organizationId,
              propertyId: current.source.propertyId,
              reviewId: data.reviewId,
              actorUserId: ctx.userId,
            },
            data,
          )
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'POST',
      'ai.recordDraftMeasurement',
    ),
  )
