// Notification context — badge.awarded handler
// Enqueues one insert-notification job per assigned manager with the
// correct InsertNotificationJobData payload shape.
//
// This handler used to put the raw badge-definition UUID in the body ("Badge
// definition: 7f0c…"). It now resolves the badge's catalogue name and the
// portal / portal-group that earned it, so the row reads "Front desk earned
// Fast Responder".

import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { RecognitionLookupPort } from '../../application/ports/recognition-lookup.port'
import type { BadgeAwarded } from '#/contexts/badge/application/public-api'
import type { PortalGroupId, PortalId } from '#/shared/domain/ids'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import { buildBadgePayload, type BadgeTarget } from './payload-facts'

type Deps = Readonly<{
  queue: Queue
  userLookup: UserLookupPort
  recognitionLookup: RecognitionLookupPort
  logger: LoggerPort
}>

export const onBadgeAwarded =
  (deps: Deps) =>
  async (event: BadgeAwarded): Promise<void> => {
    const managerIds = await deps.userLookup.findAssignedManagers(
      event.organizationId,
      event.propertyId,
    )

    if (managerIds.length === 0) {
      deps.logger.info(
        { correlationId: event.correlationId ?? undefined },
        'onBadgeAwarded: no recipients found, skipping',
      )
      return
    }

    // The event's targetType decides which table names the recipient.
    const target: BadgeTarget =
      event.targetType === 'portal'
        ? { kind: 'portal', id: event.targetId as PortalId }
        : { kind: 'portal_group', id: event.targetId as PortalGroupId }

    const payload = await buildBadgePayload(deps, {
      badgeDefinitionId: event.badgeDefinitionId,
      target,
      orgId: event.organizationId,
    })

    // Enqueue one job per manager — the worker contract expects a
    // single userId per InsertNotificationJobData.
    await Promise.all(
      managerIds.map((userId) =>
        deps.queue.add(
          INSERT_NOTIFICATION_JOB_NAME,
          {
            userId,
            organizationId: event.organizationId,
            propertyId: event.propertyId,
            type: 'badge.awarded',
            priority: 'normal',
            resourceType: 'badge',
            resourceId: event.badgeDefinitionId,
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
