// Notification context — event handler for inbox.inbox_item.created
// Notifies assigned managers about new reviews AND feedback. Branches on
// sourceType (ADR 0022): review → 'review.created', feedback → 'feedback.created'.
// resourceId is the inboxItemId — the honest deep-link target (vs the old
// review.created handler that stamped a reviewId under resourceType 'inbox_item').

import type { Queue } from 'bullmq'
import type { InboxItemCreated } from '#/contexts/inbox/application/public-api'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

export type OnInboxItemCreatedDeps = Readonly<{
  queue: Queue
  userLookup: UserLookupPort
  logger: LoggerPort
}>

export const onInboxItemCreated =
  (deps: OnInboxItemCreatedDeps) =>
  async (event: InboxItemCreated): Promise<void> => {
    if (event.sourceType !== 'review' && event.sourceType !== 'feedback') {
      deps.logger.debug('onInboxItemCreated: skipping unknown source', {
        sourceType: event.sourceType,
      })
      return
    }

    if (!event.propertyId) {
      deps.logger.debug('onInboxItemCreated: no propertyId, skipping', {
        eventId: event.eventId,
      })
      return
    }

    const recipients = await deps.userLookup.findAssignedManagers(
      event.organizationId,
      event.propertyId,
    )

    if (recipients.length === 0) {
      deps.logger.warn(
        { propertyId: event.propertyId, eventId: event.eventId },
        'onInboxItemCreated: no recipients found',
      )
      return
    }

    const isReview = event.sourceType === 'review'
    const type = isReview ? 'review.created' : 'feedback.created'
    const title = isReview ? 'New review' : 'New feedback'
    // BQC-1.2: content-free template — no rating (raw source content);
    // ADR 0046 r.8: property/resource/status metadata only.
    const body = isReview ? 'New review received' : 'A guest submitted feedback'

    await Promise.all(
      recipients.map((userId) =>
        deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, {
          userId,
          organizationId: event.organizationId,
          type,
          resourceType: 'inbox_item',
          resourceId: event.inboxItemId,
          eventId: event.eventId,
          title,
          body,
        }),
      ),
    )
  }
