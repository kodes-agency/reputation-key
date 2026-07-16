// Review context — reply moderation server functions
// Per architecture: "Server functions are the HTTP entry points into a context."

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { isReviewError } from '../domain/errors'
import { reviewId } from '#/shared/domain/ids'
import { reviewErrorStatus, reviewIdDto, rejectReplyDto } from './reply-read'
import { requireAuthorized } from '#/shared/auth/authorization-policy'

// ── rejectReply ──────────────────────────────────────────────────────

export const rejectReplyFn = createServerFn({ method: 'POST' })
  .inputValidator(rejectReplyDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        requireAuthorized({ actor: ctx, action: 'reply.manage' })
        const { useCases } = getContainer()
        try {
          return await useCases.rejectReply(
            { reviewId: reviewId(data.reviewId), reason: data.reason },
            ctx,
          )
        } catch (e) {
          if (isReviewError(e))
            throwContextError('ReviewError', e, reviewErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'review.rejectReply',
    ),
  )

// ── deleteReply ──────────────────────────────────────────────────────

export const deleteReplyFn = createServerFn({ method: 'POST' })
  .inputValidator(reviewIdDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        requireAuthorized({ actor: ctx, action: 'reply.manage' })
        const { useCases } = getContainer()
        try {
          await useCases.deleteReply({ reviewId: reviewId(data.reviewId) }, ctx)
          return { success: true }
        } catch (e) {
          if (isReviewError(e))
            throwContextError('ReviewError', e, reviewErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'review.deleteReply',
    ),
  )

// ── retryPublish ─────────────────────────────────────────────────────

export const retryPublishFn = createServerFn({ method: 'POST' })
  .inputValidator(reviewIdDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        requireAuthorized({ actor: ctx, action: 'reply.manage' })
        const { useCases } = getContainer()
        try {
          return await useCases.retryPublish({ reviewId: reviewId(data.reviewId) }, ctx)
        } catch (e) {
          if (isReviewError(e))
            throwContextError('ReviewError', e, reviewErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'review.retryPublish',
    ),
  )

// ── Re-exports from split files ──────────────────────────────────────

export { getReplyFn } from './reply-read'
export { draftReplyFn, submitReplyFn, approveReplyFn } from './reply-draft'
