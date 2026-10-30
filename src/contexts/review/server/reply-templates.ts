import { createServerFn } from '@tanstack/react-start'
import { getContainer } from '#/composition'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { catchUntagged, throwContextError } from '#/shared/auth/server-errors'
import { reviewId } from '#/shared/domain/ids'
import {
  checkReplyDraftInputSchema,
  listReplyTemplatesInputSchema,
  loadReplyTemplateInputSchema,
  replyLibraryRefSchema,
  type ReplyLibraryRef,
} from '../application/dto/reply-library.dto'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { isReviewError } from '../domain/errors'
import { reviewErrorStatus } from './reply-read'

export const listReplyTemplatesFn = createServerFn({ method: 'POST' })
  .validator(listReplyTemplatesInputSchema)
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
  .validator(loadReplyTemplateInputSchema)
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
              ref: replyLibraryRefSchema.parse(
                data.templateId.startsWith('builtin:') ||
                  data.templateId.startsWith('template:')
                  ? data.templateId
                  : `template:${data.templateId}`,
              ) as ReplyLibraryRef,
              targetLanguage: data.targetLanguage,
              ...(data.excludeWordingKeys === undefined
                ? {}
                : { excludeWordingKeys: data.excludeWordingKeys }),
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

// fallow-ignore-next-line unused-export -- resolved by the Inbox dynamic import
export const checkReplyDraftFn = createServerFn({ method: 'POST' })
  .validator(checkReplyDraftInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'reply.manage' })
        try {
          return await getContainer().reviewPublicApi.reply.checkDraft(
            { reviewId: reviewId(data.reviewId), text: data.text },
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
      'review.checkReplyDraft',
    ),
  )
