// Notification context — event handler for review.reply.published
// Notifies the reply author that their reply was published to Google.

import type { ReviewReplyPublished } from '#/contexts/review/application/public-api'
import { makeReplyNotificationHandler } from './reply-notification'

export const onReplyPublished = makeReplyNotificationHandler<ReviewReplyPublished>({
  type: 'reply.published' as const,
})
