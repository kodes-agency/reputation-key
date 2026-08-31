// Notification context — event handler registration (BullMQ-backed)
// Per-tag handlers subscribe to domain events and enqueue BullMQ jobs.
// Per architecture (ADR 0010): "Handlers map event → job payload, worker calls use case."

import type { EventBus } from '#/shared/events/event-bus'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { InboxItemLookupPort } from '../../application/ports/inbox-item-lookup.port'
import type { ResponsibleManagerLookupPort } from '../../application/ports/responsible-manager-lookup.port'
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
import {
  onGoogleReauthorizationRequired,
  type GoogleConnectionPropertyLookup,
} from './on-google-reauthorization-required'
import type { NotificationJobEnqueuePort } from '../inbox-notification-fanout'

export type RegisterNotificationHandlersDeps = Readonly<{
  events: EventBus
  queue: NotificationJobEnqueuePort
  userLookup: UserLookupPort
  responsibleManagers: ResponsibleManagerLookupPort
  inboxItemLookup: InboxItemLookupPort
  googleConnectionProperties: GoogleConnectionPropertyLookup
  /** Injected — handlers measure a waiting age, and this code never calls Date.now(). */
  clock: () => Date
  logger: LoggerPort
}>

export const registerNotificationHandlers = (
  deps: RegisterNotificationHandlersDeps,
): void => {
  const {
    events,
    queue,
    userLookup,
    responsibleManagers,
    inboxItemLookup,
    googleConnectionProperties,
    clock,
    logger,
  } = deps

  // Every inbox-keyed handler assembles its payload from the same four things:
  // the item facts, the acting user's role, a clock for the waiting age, and a
  // logger for a degraded lookup.
  const inboxFacts = {
    userLookup,
    responsibleManagers,
    inboxItemLookup,
    clock,
    logger,
  }
  // Inbox events (reviews + feedback both arrive via inbox.inbox_item.created)
  events.on('inbox.inbox_item.created', onInboxItemCreated({ queue, ...inboxFacts }), {
    consumer: 'notification.event-handlers',
  })
  events.on('inbox.inbox_item.assigned', onInboxItemAssigned({ queue, ...inboxFacts }), {
    consumer: 'notification.event-handlers',
  })
  events.on(
    'inbox.inbox_item.escalated',
    onInboxItemEscalated({ queue, ...inboxFacts }),

    { consumer: 'notification.event-handlers' },
  )
  events.on('inbox.inbox_note.added', onInboxNoteAdded({ queue, ...inboxFacts }), {
    consumer: 'notification.event-handlers',
  })

  // Reply lifecycle
  events.on(
    'review.reply.submitted',
    onReplySubmitted({ queue, ...inboxFacts }),

    { consumer: 'notification.event-handlers' },
  )
  events.on('review.reply.approved', onReplyApproved({ queue, ...inboxFacts }), {
    consumer: 'notification.event-handlers',
  })
  events.on('review.reply.rejected', onReplyRejected({ queue, ...inboxFacts }), {
    consumer: 'notification.event-handlers',
  })
  events.on('review.reply.published', onReplyPublished({ queue, ...inboxFacts }), {
    consumer: 'notification.event-handlers',
  })
  events.on(
    'review.reply.publish_failed',
    onReplyPublishFailed({ queue, ...inboxFacts }),

    { consumer: 'notification.event-handlers' },
  )
  events.on(
    'integration.google_account.reauthorization_required',
    onGoogleReauthorizationRequired({
      queue,
      userLookup,
      googleConnectionProperties,
      logger,
    }),
    { consumer: 'notification.event-handlers' },
  )
}
