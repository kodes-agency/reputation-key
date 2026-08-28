// Durable notification admission for canonical Inbox Handling Cycle facts.
//
// The consumer and the insert-notification worker both resolve the exact
// current cycle/head. The first read prevents obviously obsolete fan-out; the
// delivery-time audience check closes the queue-delay race and revalidates the
// current Property/Portal Responsible Managers. Event and job payloads contain
// identifiers and workflow revisions only.

import { registerConsumer, type ConsumerEvent } from '#/shared/outbox'
import type { OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import {
  inboxItemId,
  organizationId,
  propertyId,
  unbrand,
  userId,
  type UserId,
} from '#/shared/domain/ids'
import type { NotificationType } from '../domain/types'
import type { NotificationAudience } from '../application/notification-audience'
import { resolveInboxResponsibleRecipients } from '../application/responsible-recipients'
import type { InboxFanoutDeps } from './inbox-notification-fanout'
import { buildInboxItemPayload } from './event-handlers/payload-facts'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'

const OPENED_EVENT = 'inbox.handling_cycle.opened' as const
const REOPENED_EVENT = 'inbox.handling_cycle.reopened' as const

export const ON_INBOX_HANDLING_CYCLE_OPENED_CONSUMER =
  'notification.on-inbox-handling-cycle-opened' as const
export const ON_INBOX_HANDLING_CYCLE_REOPENED_CONSUMER =
  'notification.on-inbox-handling-cycle-reopened' as const

export type HandlingCycleNotificationConsumerDeps = InboxFanoutDeps &
  Readonly<{
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>

type HandlingCyclePayload = Readonly<{
  inboxItemId: string
  cycleNumber: number
  stateRevision: number
  organizationId: string
  propertyId: string
  sourceType: 'review' | 'feedback'
  sourceId: string
  sourceRevision: number
  actorType: 'user' | 'guest' | 'provider' | 'system'
  userId: string | null
  triggerEventId: string | null
  openReason?: string
  reopenReason?: string
  source: 'web' | 'import'
  occurredAt: string
}>

type Parsed = HandlingCyclePayload &
  Readonly<{
    eventType: typeof OPENED_EVENT | typeof REOPENED_EVENT
    consumerName:
      | typeof ON_INBOX_HANDLING_CYCLE_OPENED_CONSUMER
      | typeof ON_INBOX_HANDLING_CYCLE_REOPENED_CONSUMER
  }>

function parse(event: ConsumerEvent): Parsed {
  if (event.eventType !== OPENED_EVENT && event.eventType !== REOPENED_EVENT) {
    throw new Error('Unsupported Inbox Handling Cycle notification event')
  }
  const payload = validateEventPayload(
    event.eventType,
    event.eventVersion,
    event.payload,
  ) as HandlingCyclePayload | undefined
  if (
    event.eventVersion !== 1 ||
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Inbox Handling Cycle notification envelope attribution mismatch')
  }
  return {
    ...payload,
    eventType: event.eventType,
    consumerName:
      event.eventType === OPENED_EVENT
        ? ON_INBOX_HANDLING_CYCLE_OPENED_CONSUMER
        : ON_INBOX_HANDLING_CYCLE_REOPENED_CONSUMER,
  }
}

/**
 * Initial observations/submissions are already represented by
 * `inbox.inbox_item.created`; consuming them again would produce two arrival
 * notifications. Only a material Review revision maps from `opened`.
 */
function notificationTypeFor(payload: Parsed): NotificationType | null {
  if (payload.eventType === REOPENED_EVENT) return 'inbox.reopened'
  return payload.openReason === 'material_revision_changed' &&
    payload.sourceType === 'review'
    ? 'review.updated'
    : null
}

function exactCurrent(
  payload: Parsed,
  facts: Awaited<
    ReturnType<
      HandlingCycleNotificationConsumerDeps['inboxItemLookup']['findHandlingCycleNotificationFacts']
    >
  >,
): facts is NonNullable<typeof facts> {
  return (
    facts !== null &&
    facts.propertyId === payload.propertyId &&
    facts.sourceType === payload.sourceType &&
    facts.sourceId === payload.sourceId &&
    facts.currentCycleNumber === payload.cycleNumber &&
    facts.currentSourceRevision === payload.sourceRevision &&
    facts.stateRevision === payload.stateRevision &&
    facts.status === 'open'
  )
}

export async function handleNotificationHandlingCycle(
  deps: HandlingCycleNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
  const payload = parse(event)
  const notificationType = notificationTypeFor(payload)

  // Valid evidence with no user-facing effect: the existing item-created path
  // owns initial arrival delivery and legacy backfills never notify.
  if (notificationType === null) {
    await deps.receipts.insertReceipt(event.eventId, payload.consumerName, 'applied')
    return { status: 'applied' }
  }

  const orgId = organizationId(payload.organizationId)
  const itemId = inboxItemId(payload.inboxItemId)
  const facts = await deps.inboxItemLookup.findHandlingCycleNotificationFacts(
    itemId,
    orgId,
  )
  if (!exactCurrent(payload, facts)) {
    await deps.receipts.insertReceipt(event.eventId, payload.consumerName, 'obsolete')
    return { status: 'obsolete' }
  }

  const actorUserId: UserId | null = payload.userId ? userId(payload.userId) : null
  const recipients = (await resolveInboxResponsibleRecipients(deps, orgId, facts)).filter(
    (recipient) => recipient !== actorUserId,
  )
  const notificationPayload = await buildInboxItemPayload(deps, {
    inboxItemId: itemId,
    orgId,
    actorId: actorUserId,
  })
  const audience: NotificationAudience = {
    kind: 'handling_cycle',
    inboxItemId: itemId,
    sourceType: payload.sourceType,
    sourceId: payload.sourceId,
    cycleNumber: payload.cycleNumber,
    sourceRevision: payload.sourceRevision,
    stateRevision: payload.stateRevision,
    actorUserId,
  }

  await Promise.all(
    recipients.map((recipient) =>
      deps.queue.add(
        INSERT_NOTIFICATION_JOB_NAME,
        {
          userId: recipient,
          organizationId: orgId,
          propertyId: propertyId(payload.propertyId),
          type: notificationType,
          resourceType: 'inbox_item' as const,
          resourceId: itemId,
          eventId: event.eventId,
          payload: notificationPayload,
          audience,
        },
        { jobId: `${event.eventId}-${unbrand(recipient)}` },
      ),
    ),
  )

  // Receipt last: a partial enqueue failure remains retryable and stable job
  // ids converge the successful subset on relay replay.
  await deps.receipts.insertReceipt(event.eventId, payload.consumerName, 'applied')
  return { status: 'applied' }
}

export function registerHandlingCycleNotificationConsumers(
  deps: HandlingCycleNotificationConsumerDeps,
): void {
  registerConsumer({
    eventType: 'inbox.handling_cycle.opened',
    consumerName: 'notification.on-inbox-handling-cycle-opened',
    module: 'notification.handling-cycle-outbox-consumers',
    handler: (event) => handleNotificationHandlingCycle(deps, event),
  })
  registerConsumer({
    eventType: 'inbox.handling_cycle.reopened',
    consumerName: 'notification.on-inbox-handling-cycle-reopened',
    module: 'notification.handling-cycle-outbox-consumers',
    handler: (event) => handleNotificationHandlingCycle(deps, event),
  })
}
