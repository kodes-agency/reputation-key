// Review context — reply server functions
// Per architecture: "Server functions are the HTTP entry points into a context."

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { match } from 'ts-pattern'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { throwContextError } from '#/shared/auth/server-errors'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { isReviewError } from '../domain/errors'
import type { ReviewErrorCode } from '../domain/errors'
import { reviewId } from '#/shared/domain/ids'
import { can } from '#/shared/domain/permissions'
import { MAX_REPLY_LENGTH } from '../domain/rules'

// ── Error → HTTP status mapping ──────────────────────────────────────

const reviewErrorStatus = (code: ReviewErrorCode): number =>
  match(code)
    .with('invalid_reply', 'invalid_rating', 'invalid_transition', () => 400)
    .with('unauthorized', () => 403)
    .with('review_not_found', 'reply_not_found', () => 404)
    .with('reply_already_exists', () => 409)
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

const reviewIdDto = z.object({ reviewId: z.string().uuid() })

const draftReplyDto = z.object({
  reviewId: z.string().uuid(),
  text: z.string().min(1).max(MAX_REPLY_LENGTH),
})

const rejectReplyDto = z.object({
  reviewId: z.string().uuid(),
  reason: z.string().max(1000).optional(),
})

// ── getReply ─────────────────────────────────────────────────────────

export const getReplyFn = createServerFn({ method: 'GET' })
  .inputValidator(reviewIdDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
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
          throw e
        }
      },
      'GET',
      'review.getReply',
    ),
  )

// ── draftReply ───────────────────────────────────────────────────────

export const draftReplyFn = createServerFn({ method: 'POST' })
  .inputValidator(draftReplyDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
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
          throw e
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
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
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
          throw e
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
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
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
          throw e
        }
      },
      'POST',
      'review.approveReply',
    ),
  )

// ── rejectReply ──────────────────────────────────────────────────────

export const rejectReplyFn = createServerFn({ method: 'POST' })
  .inputValidator(rejectReplyDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { useCases } = getContainer()
        try {
          return await useCases.rejectReply({
            reviewId: reviewId(data.reviewId),
            organizationId: ctx.organizationId,
            reason: data.reason,
            userId: ctx.userId,
            role: ctx.role,
          })
        } catch (e) {
          if (isReviewError(e))
            throwContextError('ReviewError', e, reviewErrorStatus(e.code))
          throw e
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
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { useCases } = getContainer()
        try {
          await useCases.deleteReply({
            reviewId: reviewId(data.reviewId),
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            role: ctx.role,
          })
          return { success: true }
        } catch (e) {
          if (isReviewError(e))
            throwContextError('ReviewError', e, reviewErrorStatus(e.code))
          throw e
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
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { useCases } = getContainer()
        try {
          return await useCases.retryPublish({
            reviewId: reviewId(data.reviewId),
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            role: ctx.role,
          })
        } catch (e) {
          if (isReviewError(e))
            throwContextError('ReviewError', e, reviewErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'review.retryPublish',
    ),
  )
