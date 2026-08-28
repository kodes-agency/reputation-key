import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { organizationId, unbrand } from '#/shared/domain/ids'
import type { NotificationType } from '../domain/types'
import type { OrganizationAccountNotificationEventType } from '../application/ports/organization-account-notification-authority.port'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import { affectedUserFromIdentityFact } from './adapters/organization-account-notification-authority.adapter'

export const IDENTITY_ACCOUNT_NOTIFICATION_CONSUMERS = [
  {
    eventType: 'identity.invitation.accepted',
    consumerName: 'notification.on-identity-invitation-accepted',
    notificationType: 'account.organization_access_granted',
  },
  {
    eventType: 'identity.member.role_changed',
    consumerName: 'notification.on-identity-member-role-changed',
    notificationType: 'account.organization_role_changed',
  },
  {
    eventType: 'identity.member.removed',
    consumerName: 'notification.on-identity-member-removed',
    notificationType: 'account.organization_access_removed',
  },
] as const satisfies ReadonlyArray<{
  eventType: OrganizationAccountNotificationEventType
  consumerName: string
  notificationType: NotificationType
}>

export type IdentityAccountNotificationConsumerDeps = Readonly<{
  queue: NotificationJobEnqueuePort
  receipts: Pick<OutboxRepository, 'insertReceipt'>
}>

const routeFor = (eventType: string) =>
  IDENTITY_ACCOUNT_NOTIFICATION_CONSUMERS.find(
    (candidate) => candidate.eventType === eventType,
  )

export async function handleIdentityAccountNotificationEvent(
  deps: IdentityAccountNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' }>> {
  const route = routeFor(event.eventType)
  if (!route) throw new Error(`Unsupported Identity account event: ${event.eventType}`)
  if (event.propertyId !== null || event.sourceContext !== 'identity') {
    throw new Error('Identity account-notification envelope attribution mismatch')
  }
  const organization = organizationId(event.organizationId)

  const recipient = affectedUserFromIdentityFact({
    eventType: route.eventType,
    eventVersion: event.eventVersion,
    organizationId: organization,
    payload: event.payload,
  })
  const recipientId = unbrand(recipient)

  await deps.queue.add(
    INSERT_NOTIFICATION_JOB_NAME,
    {
      userId: recipient,
      organizationId: organization,
      propertyId: null,
      type: route.notificationType,
      resourceType: 'organization',
      resourceId: event.organizationId,
      eventId: event.eventId,
      audience: {
        kind: 'affected_organization_user',
        eventId: event.eventId,
        eventType: route.eventType,
      },
    },
    { jobId: `${event.eventId}-${recipientId}` },
  )
  await deps.receipts.insertReceipt(event.eventId, route.consumerName, 'applied')
  return { status: 'applied' }
}

export function registerIdentityAccountNotificationConsumers(
  registry: ConsumerRegistry,
  deps: IdentityAccountNotificationConsumerDeps,
): void {
  const { registerConsumer } = registry
  // Written explicitly so governance can mechanically prove the exact
  // event→consumer identities without executing context composition.
  registerConsumer({
    eventType: 'identity.invitation.accepted',
    consumerName: 'notification.on-identity-invitation-accepted',
    module: 'notification.identity-account-outbox-consumers',
    handler: (event) => handleIdentityAccountNotificationEvent(deps, event),
  })
  registerConsumer({
    eventType: 'identity.member.role_changed',
    consumerName: 'notification.on-identity-member-role-changed',
    module: 'notification.identity-account-outbox-consumers',
    handler: (event) => handleIdentityAccountNotificationEvent(deps, event),
  })
  registerConsumer({
    eventType: 'identity.member.removed',
    consumerName: 'notification.on-identity-member-removed',
    module: 'notification.identity-account-outbox-consumers',
    handler: (event) => handleIdentityAccountNotificationEvent(deps, event),
  })
}
