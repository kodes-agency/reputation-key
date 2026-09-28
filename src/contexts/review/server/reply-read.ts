// Review context — reply shared helpers (split from reply.ts): the error-status
// mapping and input DTOs the reply server functions share.

import { match } from 'ts-pattern'
import { HTTP_STATUS } from '#/shared/http/status'
import { z } from 'zod/v4'
import type { ReviewErrorCode } from '../domain/errors'
import { replyCommentProblem } from '#/shared/google-provider-control/reply-comment'
import { replyTextProblemMessage } from '../domain/rules'
import { parseCanonicalReplyLanguageTag } from '#/shared/reply-language-catalogue'

// ── Error → HTTP status mapping ──────────────────────────────────────

export const reviewErrorStatus = (code: ReviewErrorCode): number =>
  match(code)
    .with(
      'invalid_reply',
      'invalid_input',
      'invalid_rating',
      'invalid_transition',
      'ai_suggestion_invalid',
      () => HTTP_STATUS.BAD_REQUEST,
    )
    .with('unauthorized', 'forbidden', () => HTTP_STATUS.FORBIDDEN)
    .with('review_not_found', 'reply_not_found', () => HTTP_STATUS.NOT_FOUND)
    .with('reply_already_exists', () => HTTP_STATUS.CONFLICT)
    .with('ai_suggestion_expired', 'ai_suggestion_stale', () => HTTP_STATUS.CONFLICT)
    .with('ai_suggestion_unavailable', () => 503)
    .with(
      'property_not_found',
      'connection_not_found',
      'connection_inactive',
      'sync_failed',
      'reply_publish_failed',
      'repo_upsert_failed',
      'build_config_error',
      'invalid_row',
      () => 500,
    )
    .exhaustive()

// ── DTOs ─────────────────────────────────────────────────────────────

export const reviewIdDto = z.object({ reviewId: z.uuid() })

export const draftReplyDto = z.object({
  reviewId: z.uuid(),
  // Google's byte rule, not a character cap: `.max(4096)` counted UTF-16 units
  // and let 2049 Cyrillic letters (4098 bytes) reach a worker that cannot send
  // them. The use case checks the same rule and says why in words.
  text: z.string().superRefine((text, ctx) => {
    const problem = replyCommentProblem(text)
    if (problem !== null) {
      ctx.addIssue({ code: 'custom', message: replyTextProblemMessage(problem) })
    }
  }),
  replyLanguageTag: z
    .string()
    .min(7)
    .max(35)
    .refine((value) => parseCanonicalReplyLanguageTag(value) !== null, {
      message: 'Unsupported reply language',
    })
    .optional(),
  provenanceToken: z.string().min(1).max(16_384).optional(),
})

export const rejectReplyDto = z.object({
  reviewId: z.uuid(),
  reason: z.string().max(1000).optional(),
})
