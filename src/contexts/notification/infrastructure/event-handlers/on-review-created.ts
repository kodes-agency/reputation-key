// Notification context — event handler for review.created
// Notifies property managers about new reviews.

import type { Queue } from 'bullmq'
import type { ReviewCreated } from '#/contexts/review/application/public-api'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

type Deps = Readonly<{
  queue: Queue
  userLookup: UserLookupPort
  logger: LoggerPort
}>

export const onReviewCreated =
  (deps: Deps) =>
  async (event: ReviewCreated): Promise<void> => {
    const recipients = await deps.userLookup.findAssignedManagers(event.propertyId)

    if (recipients.length === 0) {
      deps.logger.warn(
        { propertyId: event.propertyId, eventId: event.eventId },
        'onReviewCreated: no recipients found, skipping',
      )
      return
    }

    await Promise.all(
      recipients.map((userId) =>
        deps.queue.add(INSERT_NOTIFICATION_JOB_NAME, {
          userId,
          organizationId: event.organizationId,
          type: 'review.created' as const,
          resourceType: 'inbox_item' as const,
          resourceId: event.reviewId,
          eventId: event.eventId,
          title: 'New review',
          body: `${event.rating}-star review received`,
        }),
      ),
    )
  }
