// Notification context — event handler for review.reply.rejected
// Notifies the reply author that their reply was rejected, including the reason if available.

import type { ReviewReplyRejected } from '#/contexts/review/application/public-api'
import { makeReplyNotificationHandler } from './reply-notification'

export const onReplyRejected = makeReplyNotificationHandler<ReviewReplyRejected>({
  type: 'reply.rejected' as const,
  title: 'Reply rejected',
  body: (event) =>
    event.reason ? `Rejected: ${event.reason}` : 'Your reply has been rejected',
})
