// Inbox context — "check this review on Google" server function.

import { createServerFn } from '@tanstack/react-start'
import { runInboxCommand } from './inbox-command'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { reviewId } from '#/shared/domain/ids'
import { checkReviewOnGoogleDto } from '../inbox/contracts'

/**
 * Read one review from Google now and say what it shows. Authorized as viewing
 * the review's Inbox item (`inbox.read`), so it runs under the same execution
 * policy as the detail read. The answer is a verdict only: `reply_found`,
 * `no_reply`, `unavailable`, `not_checkable` or `rate_limited`. A refusal to
 * authorize is the only error, and a call over the budget (1 per review per
 * 60 s, 30 per Organization per minute) is an answer, not a 429.
 */
export const checkReviewOnGoogleFn = createServerFn({ method: 'POST' })
  .validator(checkReviewOnGoogleDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxCommand('inbox.read', (inbox, ctx) =>
          inbox.checkInboxReviewOnGoogle({ reviewId: reviewId(data.reviewId) }, ctx),
        ),
      'POST',
      'inbox.checkReviewOnGoogle',
    ),
  )
