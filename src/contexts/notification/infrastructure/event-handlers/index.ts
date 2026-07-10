// Notification context — event handler registration (BullMQ-backed)
// Per-tag handlers subscribe to domain events and enqueue BullMQ jobs.
// Per architecture (ADR 0010): "Handlers map event → job payload, worker calls use case."

import type { EventBus } from '#/shared/events/event-bus'
import type { Queue } from 'bullmq'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { InboxItemLookupPort } from '../../application/ports/inbox-item-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { onInboxItemCreated } from './on-inbox-item-created'
import { onInboxItemAssigned } from './on-inbox-item-assigned'
import { onInboxItemEscalated } from './on-inbox-item-escalated'
import { onInboxNoteAdded } from './on-inbox-note-added'
import { onReplySubmitted } from './on-reply-submitted'
import { onReplyApproved } from './on-reply-approved'
import { onReplyRejected } from './on-reply-rejected'
import { onReplyPublished } from './on-reply-published'
import { onReplyPublishFailed } from './on-reply-publish-failed'
import { onGoalCompleted } from './on-goal-completed'
import { onBadgeAwarded } from './on-badge-awarded'

export type RegisterNotificationHandlersDeps = Readonly<{
  events: EventBus
  queue: Queue
  userLookup: UserLookupPort
  inboxItemLookup: InboxItemLookupPort
  logger: LoggerPort
}>

export const registerNotificationHandlers = (
  deps: RegisterNotificationHandlersDeps,
): void => {
  const { events, queue, userLookup, inboxItemLookup, logger } = deps

  // Inbox events (reviews + feedback both arrive via inbox.inbox_item.created)
  events.on('inbox.inbox_item.created', onInboxItemCreated({ queue, userLookup, logger }))
  events.on('inbox.inbox_item.assigned', onInboxItemAssigned({ queue }))
  events.on(
    'inbox.inbox_item.escalated',
    onInboxItemEscalated({ queue, userLookup, logger }),
  )
  events.on('inbox.inbox_note.added', onInboxNoteAdded({ queue, userLookup, logger }))

  // Reply lifecycle
  events.on(
    'review.reply.submitted',
    onReplySubmitted({ queue, userLookup, inboxItemLookup, logger }),
  )
  events.on('review.reply.approved', onReplyApproved({ queue, inboxItemLookup }))
  events.on('review.reply.rejected', onReplyRejected({ queue, inboxItemLookup }))
  events.on('review.reply.published', onReplyPublished({ queue, inboxItemLookup }))
  events.on(
    'review.reply.publish_failed',
    onReplyPublishFailed({ queue, inboxItemLookup }),
  )
  // Goal events
  events.on('goal.completed', onGoalCompleted({ queue, userLookup, logger }))

  // Badge events
  events.on('badge.awarded', onBadgeAwarded({ queue, userLookup, logger }))
}
