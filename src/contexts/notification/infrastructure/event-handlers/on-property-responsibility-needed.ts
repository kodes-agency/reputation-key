import type { PropertyResponsibilityNeeded } from '#/contexts/property/application/public-api'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { NotificationJobEnqueuePort } from '../inbox-notification-fanout'

export type PropertyResponsibilityNotificationDeps = Readonly<{
  queue: NotificationJobEnqueuePort
  userLookup: UserLookupPort
  logger: LoggerPort
}>

/** Identifier-only AccountAdmin recovery fan-out for an unowned Property. */
export const onPropertyResponsibilityNeeded =
  (deps: PropertyResponsibilityNotificationDeps) =>
  async (event: PropertyResponsibilityNeeded): Promise<void> => {
    const recipients = await deps.userLookup.findByRole(
      event.organizationId,
      'AccountAdmin',
    )
    if (recipients.length === 0) {
      deps.logger.warn(
        { correlationId: event.correlationId ?? undefined },
        'onPropertyResponsibilityNeeded: no recipients found, skipping',
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
            type: 'property.responsibility_needed' as const,
            resourceType: 'property' as const,
            resourceId: event.propertyId,
            eventId: event.eventId,
            payload: {},
            audience: { kind: 'account_admin' as const },
          },
          { jobId: `${event.eventId}-${recipientId}` },
        ),
      ),
    )
  }
