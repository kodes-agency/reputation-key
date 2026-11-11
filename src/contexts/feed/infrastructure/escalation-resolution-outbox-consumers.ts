import type { ConsumerEvent, ConsumerRegistry } from '#/shared/outbox'
import type { ConsumerResult } from '#/shared/outbox/consumer-registry'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { inboxItemId, organizationId, userId } from '#/shared/domain/ids'
import type { EscalationResolutionLookupPort } from '../application/ports/escalation-resolution-lookup.port'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { NotificationRepositoryPort } from '../application/ports/notification-repository.port'
import type { InboxItemLookupPort } from '../application/ports/notification-inbox-item-lookup.port'
import { resolveEscalationResolutionRecipients } from '../application/escalation-resolution-recipients'
import { deliverNotices, type NoticeDeliveryDeps } from '../notify/consumers.server'

export const ON_INBOX_ESCALATION_RESOLVED_CONSUMER =
  'notification.on-inbox-escalation-resolved' as const

export type EscalationResolutionNotificationConsumerDeps = NoticeDeliveryDeps &
  Readonly<{
    escalationResolutions: EscalationResolutionLookupPort
    responsibleManagers: ResponsibleManagerLookupPort
    userLookup: Pick<UserLookupPort, 'findByRole'>
    /** The evidence of who was told the escalation was raised. */
    notifications: Pick<NotificationRepositoryPort, 'findRecipientsOfNotice'>
    /** Which scope the escalation went to, so the resolution follows it. */
    inboxItemLookup: Pick<InboxItemLookupPort, 'findInboxItemFacts'>
  }>

type Payload = Readonly<{
  inboxItemId: string
  organizationId: string
  propertyId?: string | null
  userId?: string | null
  occurredAt?: string
}>

type Parsed = Readonly<{
  inboxItemId: string
  organizationId: string
  propertyId: string | null
  resolvedBy: string | null
  occurredAt: Date | null
}>

function parse(event: ConsumerEvent): Parsed {
  const payload = validateEventPayload(
    'inbox.inbox_item.escalation_resolved',
    event.eventVersion,
    event.payload,
  ) as Payload | undefined
  if (!payload || payload.organizationId !== event.organizationId) {
    throw new Error('Inbox escalation-resolution envelope attribution mismatch')
  }
  if (payload.propertyId !== undefined && payload.propertyId !== event.propertyId) {
    throw new Error('Inbox escalation-resolution envelope attribution mismatch')
  }
  const occurredAtValue = payload.occurredAt ?? event.occurredAt
  const occurredAt = occurredAtValue ? new Date(occurredAtValue) : null
  return {
    inboxItemId: payload.inboxItemId,
    organizationId: payload.organizationId,
    propertyId: payload.propertyId ?? event.propertyId,
    resolvedBy: payload.userId ?? null,
    occurredAt: occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : null,
  }
}

export async function handleNotificationInboxEscalationResolved(
  deps: EscalationResolutionNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<ConsumerResult> {
  const payload = parse(event)
  const orgId = organizationId(payload.organizationId)
  const itemId = inboxItemId(payload.inboxItemId)
  const facts = await deps.escalationResolutions.findEscalationResolutionFacts(
    itemId,
    orgId,
  )
  const resolvedBy = payload.resolvedBy ? userId(payload.resolvedBy) : null

  // The row must still represent this exact resolution. Re-escalation, a
  // later resolution, deletion, or attribution drift makes the old event
  // obsolete rather than a reason to notify current managers.
  if (
    !facts ||
    payload.propertyId === null ||
    facts.propertyId !== payload.propertyId ||
    facts.isEscalated ||
    payload.occurredAt === null ||
    facts.resolvedAt?.getTime() !== payload.occurredAt.getTime() ||
    facts.resolvedBy !== resolvedBy
  ) {
    return deliverNotices(deps, event, ON_INBOX_ESCALATION_RESOLVED_CONSUMER, [], {
      status: 'obsolete',
    })
  }

  const recipients = await resolveEscalationResolutionRecipients(deps, {
    organizationId: orgId,
    propertyId: facts.propertyId,
    inboxItemId: itemId,
    assignedTo: facts.assignedTo,
    resolvedBy: facts.resolvedBy,
    escalatedAt: facts.escalatedAt,
  })
  const resolvedAt = facts.resolvedAt.toISOString()
  const notificationPayload = facts.propertyName
    ? { propertyName: facts.propertyName }
    : {}

  return deliverNotices(
    deps,
    event,
    ON_INBOX_ESCALATION_RESOLVED_CONSUMER,
    recipients.map((recipient) => ({
      userId: recipient,
      organizationId: orgId,
      propertyId: facts.propertyId,
      type: 'inbox.escalation_resolved' as const,
      resourceType: 'inbox_item' as const,
      resourceId: itemId,
      payload: notificationPayload,
      audience: {
        kind: 'escalation_resolution' as const,
        inboxItemId: itemId,
        resolvedAt,
        resolvedBy: facts.resolvedBy,
      },
    })),
  )
}

export function registerEscalationResolutionNotificationConsumer(
  registry: ConsumerRegistry,
  deps: EscalationResolutionNotificationConsumerDeps,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'inbox.inbox_item.escalation_resolved',
    consumerName: 'notification.on-inbox-escalation-resolved',
    module: 'notification.escalation-resolution-outbox-consumers',
    handler: (event) => handleNotificationInboxEscalationResolved(deps, event),
  })
}
