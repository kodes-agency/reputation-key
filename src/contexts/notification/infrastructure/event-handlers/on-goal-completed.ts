// Notification context — event handler for goal.completed
// Notifies assigned managers/staff (AccountAdmins, PropertyManagers, Staff)
// that a goal on their property has been completed — per CONTEXT.md §6.
//
// The goal NAME is what makes this recognition legible ("Goal completed:
// Weekend response time"), and the event carries only the goalId, so the name
// comes from the recognition lookup.

import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { GoalCompleted } from '#/contexts/goal/application/public-api'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { RecognitionLookupPort } from '../../application/ports/recognition-lookup.port'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import { buildGoalPayload } from './payload-facts'

type Deps = Readonly<{
  queue: Queue
  userLookup: UserLookupPort
  recognitionLookup: RecognitionLookupPort
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
        { correlationId: event.correlationId ?? undefined },
        'onGoalCompleted: no recipients found, skipping',
      )
      return
    }

    const payload = await buildGoalPayload(deps, {
      goalId: event.goalId,
      orgId: event.organizationId,
    })

    // Enqueue one job per recipient — the worker contract expects a
    // single userId per InsertNotificationJobData.
    await Promise.all(
      recipientIds.map((userId) =>
        deps.queue.add(
          INSERT_NOTIFICATION_JOB_NAME,
          {
            userId,
            organizationId: event.organizationId,
            propertyId: event.propertyId,
            type: 'goal.completed',
            resourceType: 'goal',
            resourceId: event.goalId,
            eventId: event.eventId,
            payload,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
          },
        ),
      ),
    )
  }
