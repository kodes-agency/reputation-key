import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { inboxItemId, organizationId, unbrand, userId } from '#/shared/domain/ids'
import type { EscalationResolutionLookupPort } from '../application/ports/escalation-resolution-lookup.port'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import { resolveEscalationResolutionRecipients } from '../application/escalation-resolution-recipients'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'

export const ON_INBOX_ESCALATION_RESOLVED_CONSUMER =
  'notification.on-inbox-escalation-resolved' as const

export type EscalationResolutionNotificationConsumerDeps = Readonly<{
  queue: NotificationJobEnqueuePort
  escalationResolutions: EscalationResolutionLookupPort
  responsibleManagers: ResponsibleManagerLookupPort
  receipts: Pick<OutboxRepository, 'insertReceipt'>
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
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
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
    await deps.receipts.insertReceipt(
      event.eventId,
      ON_INBOX_ESCALATION_RESOLVED_CONSUMER,
      'obsolete',
    )
    return { status: 'obsolete' }
  }

  const recipients = await resolveEscalationResolutionRecipients(deps, {
    organizationId: orgId,
    propertyId: facts.propertyId,
    assignedTo: facts.assignedTo,
    resolvedBy: facts.resolvedBy,
  })
  const resolvedAt = facts.resolvedAt.toISOString()
  const notificationPayload = facts.propertyName
    ? { propertyName: facts.propertyName }
    : {}

  await Promise.all(
    recipients.map((recipient) =>
      deps.queue.add(
        INSERT_NOTIFICATION_JOB_NAME,
        {
          userId: recipient,
          organizationId: orgId,
          propertyId: facts.propertyId,
          type: 'inbox.escalation_resolved' as const,
          resourceType: 'inbox_item' as const,
          resourceId: itemId,
          eventId: event.eventId,
          payload: notificationPayload,
          audience: {
            kind: 'escalation_resolution' as const,
            inboxItemId: itemId,
            resolvedAt,
            resolvedBy: facts.resolvedBy,
          },
        },
        { jobId: `${event.eventId}-${unbrand(recipient)}` },
      ),
    ),
  )

  // The receipt is deliberately last. Any enqueue failure leaves the event
  // retryable; stable job ids converge the successful subset on replay.
  await deps.receipts.insertReceipt(
    event.eventId,
    ON_INBOX_ESCALATION_RESOLVED_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
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
