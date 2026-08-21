// Notification context — event handler for review.reply.approved
// Notifies the reply author that their reply was approved.

import type { ReviewReplyApproved } from '#/contexts/review/application/public-api'
import { makeReplyNotificationHandler } from './reply-notification'

export const onReplyApproved = makeReplyNotificationHandler<ReviewReplyApproved>({
  type: 'reply.approved' as const,
})
