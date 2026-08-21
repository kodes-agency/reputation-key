// Notification context — event handler for review.reply.rejected
// Notifies the reply author that their reply needs changes, carrying the
// moderator's reason as a fact so the template can quote it (a staff-authored
// sentence, not source content — ADR 0046 r.8 allows it).

import type { ReviewReplyRejected } from '#/contexts/review/application/public-api'
import { makeReplyNotificationHandler } from './reply-notification'

export const onReplyRejected = makeReplyNotificationHandler<ReviewReplyRejected>({
  type: 'reply.rejected' as const,
  facts: (event) => ({ moderationReason: event.reason }),
})
