// Notification context — event handler for inbox.inbox_item.created (feedback source)
// Notifies property managers about new feedback submissions.

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
    if (event.sourceType !== 'feedback') {
      deps.logger.debug('onInboxItemCreated: skipping non-feedback source', {
        sourceType: event.sourceType,
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
        'onInboxItemCreated: no recipients found for feedback notification',
      )
      return
    }

    await Promise.all(
      recipients.map((userId) =>
        deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, {
          userId,
          organizationId: event.organizationId,
          type: 'feedback.created' as const,
          resourceType: 'inbox_item' as const,
          resourceId: event.inboxItemId,
          eventId: event.eventId,
          title: 'New feedback',
          body: 'A guest submitted feedback',
        }),
      ),
    )
  }
