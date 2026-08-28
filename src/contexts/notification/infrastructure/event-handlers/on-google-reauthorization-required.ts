import type { IntegrationGoogleAccountReauthorizationRequired } from '#/contexts/integration/application/public-api'
import {
  propertyId,
  type GoogleConnectionId,
  type OrganizationId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from '../../application/ports/user-lookup.port'
import { INSERT_NOTIFICATION_JOB_NAME } from '../jobs/insert-notification.job'
import type { NotificationJobEnqueuePort } from '../inbox-notification-fanout'

export type GoogleConnectionPropertyLookup = Readonly<{
  findGoogleNotificationAnchor: (
    connectionId: GoogleConnectionId,
    organizationId: OrganizationId,
  ) => Promise<string | null>
}>

export type GoogleReauthorizationNotificationDeps = Readonly<{
  queue: NotificationJobEnqueuePort
  userLookup: UserLookupPort
  googleConnectionProperties: GoogleConnectionPropertyLookup
  logger: LoggerPort
}>

/** Content-free AccountAdmin fan-out using a Property only as delivery scope. */
export const onGoogleReauthorizationRequired =
  (deps: GoogleReauthorizationNotificationDeps) =>
  async (event: IntegrationGoogleAccountReauthorizationRequired): Promise<void> => {
    const anchorPropertyId =
      await deps.googleConnectionProperties.findGoogleNotificationAnchor(
        event.connectionId,
        event.organizationId,
      )
    if (!anchorPropertyId) {
      deps.logger.warn(
        { correlationId: event.correlationId ?? undefined },
        'onGoogleReauthorizationRequired: Organization has no Property delivery scope, skipping notification',
      )
      return
    }
    const recipients = await deps.userLookup.findByRole(
      event.organizationId,
      'AccountAdmin',
    )
    if (recipients.length === 0) {
      deps.logger.warn(
        { correlationId: event.correlationId ?? undefined },
        'onGoogleReauthorizationRequired: no AccountAdmin recipients found, skipping',
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
            propertyId: propertyId(anchorPropertyId),
            type: 'integration.reauthorization_required' as const,
            resourceType: 'integration' as const,
            resourceId: event.connectionId,
            eventId: event.eventId,
            payload: {},
            audience: { kind: 'account_admin' as const },
          },
          { jobId: `${event.eventId}-${recipientId}` },
        ),
      ),
    )
  }
