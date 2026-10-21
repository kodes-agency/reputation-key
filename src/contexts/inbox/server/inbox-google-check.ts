// Inbox context — "check this review on Google" server function.

import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { createServerFn, isInboxError, inboxErrorStatus } from './inbox-shared'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { reviewId } from '#/shared/domain/ids'
import { checkReviewOnGoogleDto } from '../application/dto/inbox.dto'

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
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.read' })
        const { inboxPublicApi } = getContainer()
        try {
          return await inboxPublicApi.checkInboxReviewOnGoogle(
            { reviewId: reviewId(data.reviewId) },
            ctx,
          )
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'inbox.checkReviewOnGoogle',
    ),
  )
