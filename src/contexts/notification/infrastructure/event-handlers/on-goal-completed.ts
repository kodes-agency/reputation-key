// Notification context — event handler for goal.completed
// Notifies assigned managers/staff (AccountAdmins, PropertyManagers, Staff)
// that a goal on their property has been completed — per CONTEXT.md §6.

import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { GoalCompleted } from '#/contexts/goal/application/public-api'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'

type Deps = Readonly<{
  queue: Queue
  userLookup: UserLookupPort
  logger: LoggerPort
}>

export const onGoalCompleted =
  (deps: Deps) =>
  async (event: GoalCompleted): Promise<void> => {
    const recipientIds = await deps.userLookup.findAssignedManagers(
      event.organizationId,
      event.propertyId,
    )

    if (recipientIds.length === 0) {
      deps.logger.info(
        { propertyId: event.propertyId, eventId: event.eventId },
        'onGoalCompleted: no recipients found, skipping',
      )
      return
    }

    // Enqueue one job per recipient — the worker contract expects a
    // single userId per InsertNotificationJobData.
    await Promise.all(
      recipientIds.map((userId) =>
        deps.queue.add(
          INSERT_NOTIFICATION_JOB_NAME,
          {
            userId,
            organizationId: event.organizationId,
            type: 'goal.completed',
            resourceType: 'goal',
            resourceId: event.goalId,
            eventId: event.eventId,
            title: 'Goal completed! 🎉',
            body: 'A goal on your property has been completed',
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
          },
        ),
      ),
    )
  }
