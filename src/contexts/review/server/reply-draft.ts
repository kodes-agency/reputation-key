// Review context — reply draft & submit server functions (split from reply.ts)

import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { reviewId } from '#/shared/domain/ids'
import { reviewIdDto, draftReplyDto } from './reply-read'
import { runReplyCommand } from './reply-command'

// ── draftReply ───────────────────────────────────────────────────────

export const draftReplyFn = createServerFn({ method: 'POST' })
  .validator(draftReplyDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        setResponseHeader('Cache-Control', 'private, no-store, max-age=0')
        setResponseHeader('Pragma', 'no-cache')
        setResponseHeader('Expires', '0')
        return runReplyCommand((reply, ctx) =>
          reply.draft(
            {
              reviewId: reviewId(data.reviewId),
              text: data.text,
              replyLanguageTag: data.replyLanguageTag,
              provenanceToken: data.provenanceToken,
            },
            ctx,
          ),
        )
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
      async ({ data }) =>
        runReplyCommand((reply, ctx) =>
          reply.submit({ reviewId: reviewId(data.reviewId) }, ctx),
        ),
      'POST',
      'review.submitReply',
    ),
  )

// ── approveReply ─────────────────────────────────────────────────────

export const approveReplyFn = createServerFn({ method: 'POST' })
  .validator(reviewIdDto)
  .handler(
    tracedHandler(
      async ({ data }) =>
        runReplyCommand((reply, ctx) =>
          reply.approve({ reviewId: reviewId(data.reviewId) }, ctx),
        ),
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
      async ({ data }) =>
        runReplyCommand((reply, ctx) =>
          reply.editPublished(
            { reviewId: reviewId(data.reviewId), text: data.text },
            ctx,
          ),
        ),
      'POST',
      'review.editPublishedReply',
    ),
  )
