// Notification context — badge.awarded handler
// Enqueues one insert-notification job per assigned manager with the
// correct InsertNotificationJobData payload shape.

import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { BadgeAwarded } from '#/contexts/badge/application/public-api'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

export const onBadgeAwarded =
  (deps: { queue: Queue; userLookup: UserLookupPort; logger: LoggerPort }) =>
  async (event: BadgeAwarded): Promise<void> => {
    const managerIds = await deps.userLookup.findAssignedManagers(
      event.organizationId,
      event.propertyId,
    )

    if (managerIds.length === 0) {
      deps.logger.info(
        { propertyId: event.propertyId, eventId: event.eventId },
        'onBadgeAwarded: no recipients found, skipping',
      )
      return
    }

    const targetTypeLabel = event.targetType === 'portal' ? 'Portal' : 'Portal group'
    const title = `${targetTypeLabel} earned a badge`
    const body = `Badge definition: ${event.badgeDefinitionId}`

    // Enqueue one job per manager — the worker contract expects a
    // single userId per InsertNotificationJobData.
    await Promise.all(
      managerIds.map((userId) =>
        deps.queue.add(
          INSERT_NOTIFICATION_JOB_NAME,
          {
            userId,
            organizationId: event.organizationId,
            type: 'badge.awarded',
            priority: 'normal',
            resourceType: 'badge',
            resourceId: event.badgeDefinitionId,
            eventId: event.eventId,
            title,
            body,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
          },
        ),
      ),
    )
  }
