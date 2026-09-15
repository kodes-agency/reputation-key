// Review context — reply moderation server functions
// Per architecture: "Server functions are the HTTP entry points into a context."

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { reviewId } from '#/shared/domain/ids'
import { reviewIdDto, rejectReplyDto } from './reply-read'
import { runReplyCommand } from './reply-command'

// ── rejectReply ──────────────────────────────────────────────────────

export const rejectReplyFn = createServerFn({ method: 'POST' })
  .validator(rejectReplyDto)
  .handler(
    tracedHandler(
      async ({ data }) =>
        runReplyCommand((reply, ctx) =>
          reply.reject({ reviewId: reviewId(data.reviewId), reason: data.reason }, ctx),
        ),
      'POST',
      'review.rejectReply',
    ),
  )

// ── deleteReply ──────────────────────────────────────────────────────

export const deleteReplyFn = createServerFn({ method: 'POST' })
  .validator(reviewIdDto)
  .handler(
    tracedHandler(
      async ({ data }) =>
        runReplyCommand(async (reply, ctx) => {
          await reply.delete({ reviewId: reviewId(data.reviewId) }, ctx)
          return { success: true }
        }),
      'POST',
      'review.deleteReply',
    ),
  )

// ── retryPublish ─────────────────────────────────────────────────────

export const retryPublishFn = createServerFn({ method: 'POST' })
  .validator(reviewIdDto)
  .handler(
    tracedHandler(
      async ({ data }) =>
        runReplyCommand((reply, ctx) =>
          reply.retryPublish({ reviewId: reviewId(data.reviewId) }, ctx),
        ),
      'POST',
      'review.retryPublish',
    ),
  )

// ── checkReplyPublication ────────────────────────────────────────────

/**
 * D5: "Check Google again". Returns what RepKey found — live, not showing yet,
 * never sent, a different reply, unreadable, review missing, cancelled — with
 * the check time and the next automatic check. Only a refusal or an
 * unreachable Google is an error. Same authorization as retryPublishFn; it
 * never authorizes a new cycle or enqueues a publish job.
 */
export const checkReplyPublicationFn = createServerFn({ method: 'POST' })
  .validator(reviewIdDto)
  .handler(
    tracedHandler(
      async ({ data }) =>
        runReplyCommand((reply, ctx) =>
          reply.checkPublication({ reviewId: reviewId(data.reviewId) }, ctx),
        ),
      'POST',
      'review.checkReplyPublication',
    ),
  )

// ── Re-exports from split files ──────────────────────────────────────

export { getReplyFn } from './reply-read'
export {
  draftReplyFn,
  submitReplyFn,
  approveReplyFn,
  editPublishedReplyFn,
} from './reply-draft'
export { listReplyTemplatesFn, loadReplyTemplateFn } from './reply-templates'
export {
  getPropertyReplyLibraryFn,
  savePropertyReplyProfileFn,
  savePropertyReplyTemplateFn,
  setPropertyReplyTemplateEnabledFn,
} from './reply-library'
