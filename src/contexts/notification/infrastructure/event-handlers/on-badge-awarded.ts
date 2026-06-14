// Notification context — badge.awarded handler

import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { BadgeAwarded } from '#/contexts/badge/application/public-api'

export const onBadgeAwarded =
  (deps: { queue: Queue; userLookup: UserLookupPort; logger: LoggerPort }) =>
  async (event: BadgeAwarded): Promise<void> => {
    const managerIds = await deps.userLookup.findAssignedManagers(
      event.organizationId,
      event.propertyId,
    )

    await deps.queue.add(
      'insert-notification',
      {
        type: 'badge.awarded',
        priority: 'normal',
        resourceType: 'badge',
        resourceId: event.badgeDefinitionId,
        message: `${event.targetType === 'portal' ? 'Portal' : 'Portal group'} earned a badge.`,
        targetUserIds: managerIds,
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
      },
    )
  }
