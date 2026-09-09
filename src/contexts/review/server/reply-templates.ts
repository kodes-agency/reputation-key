import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { reviewId } from '#/shared/domain/ids'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { isReviewError } from '../domain/errors'
import { reviewErrorStatus } from './reply-read'

const targetLanguageDto = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('property_default') }).strict(),
  z.object({ kind: z.literal('review_language') }).strict(),
])

const listReplyTemplatesDto = z
  .object({
    reviewId: z.uuid(),
    targetLanguage: targetLanguageDto,
  })
  .strict()

const loadReplyTemplateDto = z
  .object({
    reviewId: z.uuid(),
    templateId: z.uuid(),
    targetLanguage: targetLanguageDto,
  })
  .strict()

export const listReplyTemplatesFn = createServerFn({ method: 'POST' })
  .validator(listReplyTemplatesDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'reply.manage' })
        try {
          return await getContainer().reviewPublicApi.reply.listTemplates(
            {
              reviewId: reviewId(data.reviewId),
              targetLanguage: data.targetLanguage,
            },
            ctx,
          )
        } catch (error) {
          if (isReviewError(error)) {
            throwContextError('ReviewError', error, reviewErrorStatus(error.code))
          }
          throw catchUntagged(error)
        }
      },
      'POST',
      'review.listReplyTemplates',
    ),
  )

export const loadReplyTemplateFn = createServerFn({ method: 'POST' })
  .validator(loadReplyTemplateDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'reply.manage' })
        try {
          return await getContainer().reviewPublicApi.reply.loadTemplate(
            {
              reviewId: reviewId(data.reviewId),
              templateId: data.templateId,
              targetLanguage: data.targetLanguage,
            },
            ctx,
          )
        } catch (error) {
          if (isReviewError(error)) {
            throwContextError('ReviewError', error, reviewErrorStatus(error.code))
          }
          throw catchUntagged(error)
        }
      },
      'POST',
      'review.loadReplyTemplate',
    ),
  )
