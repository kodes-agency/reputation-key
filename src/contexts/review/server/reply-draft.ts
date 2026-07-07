// Review context — reply draft & submit server functions (split from reply.ts)

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { isReviewError } from '../domain/errors'
import { reviewId } from '#/shared/domain/ids'
import { reviewErrorStatus, reviewIdDto, draftReplyDto } from './reply-read'
import { canForContext } from '#/shared/domain/permissions'

// ── draftReply ───────────────────────────────────────────────────────

export const draftReplyFn = createServerFn({ method: 'POST' })
  .inputValidator(draftReplyDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!canForContext(ctx, 'reply.manage')) {
          throwContextError(
            'AuthError',
            { code: 'unauthorized', message: 'No reply manage permission' },
            403,
          )
        }
        const { useCases } = getContainer()
        try {
          return await useCases.draftReply({
            reviewId: reviewId(data.reviewId),
            organizationId: ctx.organizationId,
            text: data.text,
            userId: ctx.userId,
            role: ctx.role,
          })
        } catch (e) {
          if (isReviewError(e))
            throwContextError('ReviewError', e, reviewErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'review.draftReply',
    ),
  )

// ── submitReply ──────────────────────────────────────────────────────

export const submitReplyFn = createServerFn({ method: 'POST' })
  .inputValidator(reviewIdDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!canForContext(ctx, 'reply.manage')) {
          throwContextError(
            'AuthError',
            { code: 'unauthorized', message: 'No reply manage permission' },
            403,
          )
        }
        const { useCases } = getContainer()
        try {
          return await useCases.submitReply({
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
      'POST',
      'review.submitReply',
    ),
  )

// ── approveReply ─────────────────────────────────────────────────────

export const approveReplyFn = createServerFn({ method: 'POST' })
  .inputValidator(reviewIdDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!canForContext(ctx, 'reply.manage')) {
          throwContextError(
            'AuthError',
            { code: 'unauthorized', message: 'No reply manage permission' },
            403,
          )
        }
        const { useCases } = getContainer()
        try {
          return await useCases.approveReply({
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
      'POST',
      'review.approveReply',
    ),
  )
