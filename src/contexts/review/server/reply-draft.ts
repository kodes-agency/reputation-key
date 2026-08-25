// Review context — reply draft & submit server functions (split from reply.ts)

import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { isReviewError } from '../domain/errors'
import { reviewId } from '#/shared/domain/ids'
import { reviewErrorStatus, reviewIdDto, draftReplyDto } from './reply-read'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'

// ── draftReply ───────────────────────────────────────────────────────

export const draftReplyFn = createServerFn({ method: 'POST' })
  .validator(draftReplyDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        setResponseHeader('Cache-Control', 'private, no-store, max-age=0')
        setResponseHeader('Pragma', 'no-cache')
        setResponseHeader('Expires', '0')
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'reply.manage' })
        const { useCases } = getContainer()
        try {
          return await useCases.draftReply(
            {
              reviewId: reviewId(data.reviewId),
              text: data.text,
              replyLanguageTag: data.replyLanguageTag,
              provenanceToken: data.provenanceToken,
            },
            ctx,
          )
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
  .validator(reviewIdDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'reply.manage' })
        const { useCases } = getContainer()
        try {
          return await useCases.submitReply({ reviewId: reviewId(data.reviewId) }, ctx)
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
  .validator(reviewIdDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'reply.manage' })
        const { useCases } = getContainer()
        try {
          return await useCases.approveReply({ reviewId: reviewId(data.reviewId) }, ctx)
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

// ── editPublishedReply ───────────────────────────────────────────────
// Edit-and-republish: edit a published reply's text and republish through the
// durable publication machine (the GBP reply update is an upsert — no
// duplicate is possible). Mirrors approveReplyFn's permission and error shape.

export const editPublishedReplyFn = createServerFn({ method: 'POST' })
  .validator(draftReplyDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'reply.manage' })
        const { useCases } = getContainer()
        try {
          return await useCases.editPublishedReply(
            { reviewId: reviewId(data.reviewId), text: data.text },
            ctx,
          )
        } catch (e) {
          if (isReviewError(e))
            throwContextError('ReviewError', e, reviewErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'review.editPublishedReply',
    ),
  )
