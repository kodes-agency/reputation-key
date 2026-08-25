import type { PortalResponsibilityNeeded } from '#/contexts/portal/application/public-api'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { NotificationJobEnqueuePort } from '../inbox-notification-fanout'

export type PortalResponsibilityNotificationDeps = Readonly<{
  queue: NotificationJobEnqueuePort
  userLookup: UserLookupPort
  logger: LoggerPort
}>

/**
 * AccountAdmin recovery fan-out. The job carries identifiers and an empty
 * render payload only; names and other portal content never cross the event or
 * queue boundary. A deterministic job id makes bus + outbox dual delivery
 * converge on one job per recipient.
 */
export const onPortalResponsibilityNeeded =
  (deps: PortalResponsibilityNotificationDeps) =>
  async (event: PortalResponsibilityNeeded): Promise<void> => {
    const recipients = await deps.userLookup.findByRole(
      event.organizationId,
      'AccountAdmin',
    )
    if (recipients.length === 0) {
      deps.logger.warn(
        { correlationId: event.correlationId ?? undefined },
        'onPortalResponsibilityNeeded: no recipients found, skipping',
      )
      return
    }

    await Promise.all(
      recipients.map((recipientId) =>
        deps.queue.add(
          INSERT_NOTIFICATION_JOB_NAME,
          {
            userId: recipientId,
            organizationId: event.organizationId,
            propertyId: event.propertyId,
            type: 'portal.responsibility_needed' as const,
            resourceType: 'portal' as const,
            resourceId: event.portalId,
            eventId: event.eventId,
            payload: {},
          },
          { jobId: `${event.eventId}-${recipientId}` },
        ),
      ),
    )
  }
