// Review context — reply read & shared helpers (split from reply.ts)

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { match } from 'ts-pattern'
import { HTTP_STATUS } from '#/shared/http/status'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { isReviewError } from '../domain/errors'
import type { ReviewErrorCode } from '../domain/errors'
import { reviewId } from '#/shared/domain/ids'
import { can } from '#/shared/domain/permissions'
import { MAX_REPLY_LENGTH } from '../domain/rules'

// ── Error → HTTP status mapping ──────────────────────────────────────

export const reviewErrorStatus = (code: ReviewErrorCode): number =>
  match(code)
    .with(
      'invalid_reply',
      'invalid_rating',
      'invalid_transition',
      () => HTTP_STATUS.BAD_REQUEST,
    )
    .with('unauthorized', () => HTTP_STATUS.FORBIDDEN)
    .with('review_not_found', 'reply_not_found', () => HTTP_STATUS.NOT_FOUND)
    .with('reply_already_exists', () => HTTP_STATUS.CONFLICT)
    .with(
      'property_not_found',
      'connection_not_found',
      'connection_inactive',
      'sync_failed',
      'reply_publish_failed',
      () => 500,
    )
    .exhaustive()

// ── DTOs ─────────────────────────────────────────────────────────────

export const reviewIdDto = z.object({ reviewId: z.string().uuid() })

export const draftReplyDto = z.object({
  reviewId: z.string().uuid(),
  text: z.string().min(1).max(MAX_REPLY_LENGTH),
})

export const rejectReplyDto = z.object({
  reviewId: z.string().uuid(),
  reason: z.string().max(1000).optional(),
})

// ── getReply ─────────────────────────────────────────────────────────

export const getReplyFn = createServerFn({ method: 'GET' })
  .inputValidator(reviewIdDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'reply.manage')) {
          throwContextError(
            'AuthError',
            { code: 'unauthorized', message: 'No reply manage permission' },
            403,
          )
        }
        const { useCases } = getContainer()
        try {
          return await useCases.getReply({
            reviewId: reviewId(data.reviewId),
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            role: ctx.role,
          })
        } catch (e) {
          if (isReviewError(e))
            throwContextError('ReviewError', e, reviewErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'GET',
      'review.getReply',
    ),
  )
