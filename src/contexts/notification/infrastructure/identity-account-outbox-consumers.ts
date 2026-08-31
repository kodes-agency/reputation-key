import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, unbrand } from '#/shared/domain/ids'
import {
  onOrganizationPurgePending,
  type OrganizationPurgePendingFact,
  type OrganizationPurgePendingNotificationDeps,
} from './event-handlers/on-organization-purge-pending'
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

/**
 * LIF-01 program bullet 5. The final notice rides on the SAME lifecycle fact
 * the closure already records, so no new event family is introduced; the
 * consumer simply ignores every state except `purge_pending`.
 */
export const ORGANIZATION_PURGE_PENDING_CONSUMER =
  'notification.on-identity-organization-purge-pending' as const

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

type LifecyclePayload = Readonly<{
  organizationId: string
  closureLineageId: string
  state: string
  revision: number
}>

/**
 * The Purge Pending final notice.
 *
 * `obsolete` is a real, recorded outcome: the lifecycle fact is emitted on
 * EVERY transition, and treating "not purge_pending" as a failure would retry
 * forever on a fact that must never produce a notice.
 */
export async function handleOrganizationPurgePendingNotice(
  deps: IdentityAccountNotificationConsumerDeps &
    Readonly<{ notify: (fact: OrganizationPurgePendingFact) => Promise<void> }>,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
  if (event.propertyId !== null || event.sourceContext !== 'identity') {
    throw new Error('Organization lifecycle envelope attribution mismatch')
  }
  const payload = validateEventPayload(
    'identity.organization_lifecycle.changed',
    event.eventVersion,
    event.payload,
  ) as LifecyclePayload | undefined
  if (!payload || payload.organizationId !== event.organizationId) {
    throw new Error('Organization lifecycle envelope attribution mismatch')
  }
  if (payload.state !== 'purge_pending') {
    await deps.receipts.insertReceipt(
      event.eventId,
      ORGANIZATION_PURGE_PENDING_CONSUMER,
      'obsolete',
    )
    return { status: 'obsolete' }
  }
  await deps.notify({
    eventId: event.eventId,
    organizationId: organizationId(event.organizationId),
    closureLineageId: payload.closureLineageId,
    revision: payload.revision,
    correlationId: event.correlationId ?? null,
  })
  await deps.receipts.insertReceipt(
    event.eventId,
    ORGANIZATION_PURGE_PENDING_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

export function registerOrganizationPurgePendingNoticeConsumer(
  registry: ConsumerRegistry,
  deps: IdentityAccountNotificationConsumerDeps &
    OrganizationPurgePendingNotificationDeps,
): void {
  const notify = onOrganizationPurgePending(deps)
  registry.registerConsumer({
    eventType: 'identity.organization_lifecycle.changed',
    consumerName: ORGANIZATION_PURGE_PENDING_CONSUMER,
    module: 'notification.identity-account-outbox-consumers',
    handler: (event) => handleOrganizationPurgePendingNotice({ ...deps, notify }, event),
  })
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
