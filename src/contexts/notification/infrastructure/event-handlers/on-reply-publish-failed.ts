// Notification context — event handler for review.reply.publish_failed
// Notifies the reply author that publishing to Google failed.

import type { ReviewReplyPublishFailed } from '#/contexts/review/application/public-api'
import { makeReplyNotificationHandler } from './reply-notification'

export const onReplyPublishFailed =
  makeReplyNotificationHandler<ReviewReplyPublishFailed>({
    type: 'reply.publish_failed' as const,
  })
