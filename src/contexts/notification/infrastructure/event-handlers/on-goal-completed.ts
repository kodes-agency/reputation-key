// Notification context — event handler for goal.completed
// Notifies current managers responsible for the completed goal's exact scope.
// Staff attribution and broad Property access are never recipient sources.
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
import type { ResponsibleManagerLookupPort } from '../../application/ports/responsible-manager-lookup.port'
import { resolveResponsibleRecipients } from '../../application/responsible-recipients'

type Deps = Readonly<{
  queue: Queue
  userLookup: UserLookupPort
  responsibleManagers: ResponsibleManagerLookupPort
  recognitionLookup: RecognitionLookupPort
  logger: LoggerPort
}>

export const onGoalCompleted =
  (deps: Deps) =>
  async (event: GoalCompleted): Promise<void> => {
    const scope = event.portalId
      ? ({ kind: 'portal', portalId: event.portalId } as const)
      : event.portalGroupId
        ? ({ kind: 'portal_group', portalGroupId: event.portalGroupId } as const)
        : ({ kind: 'property', propertyId: event.propertyId } as const)
    const recipientIds = await resolveResponsibleRecipients(
      deps,
      event.organizationId,
      scope,
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
            audience: { kind: 'responsible_scope', scope },
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
          },
        ),
      ),
    )
  }
