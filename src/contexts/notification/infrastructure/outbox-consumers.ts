// Durable notification delivery for `inbox.inbox_item.created`.
//
// The source transaction records an identifier-only outbox fact. This consumer
// resolves current recipients and copy facts, enqueues one deterministic job
// per recipient, and acknowledges only after every enqueue succeeds. The
// sibling workflow consumers cover assignment, escalation, notes, and Reply
// lifecycle facts with the same delivery guarantees.
//
// Idempotency, in the order the fences apply:
//   1. The dispatcher pre-checks `hasReceipt(eventId, consumerName)` and skips
//      a consumer that already ran.
//   2. Each enqueue carries the deterministic job id `<eventId>-<userId>`, so
//      an ambiguous relay redelivery between the enqueue and the receipt write
//      converges on the same BullMQ job instead of queueing a second one
//      (same technique as integration.property-import-dispatch).
//   3. Behind that, `insertNotification` itself is convergent: the partial
//      unique index `notifications_unread_resource_unique` on
//      (user_id, type, resource_id) WHERE status='unread' plus the repository's
//      `onConflictDoUpdate` mean a raced replay UPDATES the unread row rather
//      than inserting a second one. It is not free, though — the conflict
//      branch bumps `coalesced_count`, which is user-visible ("Updated 2
//      times"). That is exactly why fences 1 and 2 exist rather than leaning on
//      the database alone.
//
// Content-free: identifiers, an enum and counts only (ADR 0030 / BQC-7.3).

import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import {
  inboxItemId as brandInboxItemId,
  organizationId as brandOrganizationId,
} from '#/shared/domain/ids'
import {
  fanoutInboxItemNotifications,
  type InboxFanoutDeps,
} from './inbox-notification-fanout'

const INBOX_ITEM_CREATED_EVENT = 'inbox.inbox_item.created' as const
export const ON_INBOX_ITEM_CREATED_CONSUMER =
  'notification.on-inbox-item-created' as const

export type NotificationConsumerDeps = InboxFanoutDeps &
  Readonly<{
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>

type InboxItemCreatedPayload = Readonly<{
  inboxItemId: string
  organizationId: string
  propertyId?: string | null
  sourceType?: string
}>

function parseInboxItemCreated(event: ConsumerEvent): InboxItemCreatedPayload {
  const payload = validateEventPayload(
    INBOX_ITEM_CREATED_EVENT,
    event.eventVersion,
    event.payload,
  ) as InboxItemCreatedPayload | undefined
  if (!payload || payload.organizationId !== event.organizationId) {
    throw new Error('inbox item created envelope attribution mismatch')
  }
  return payload
}

/**
 * Durable `inbox.inbox_item.created` consumer — exported for unit tests.
 *
 * `sourceType` and `propertyId` are optional on the registered schema, so both
 * are resolved from the inbox item when the envelope omits them. That read
 * doubles as the existence check: an item that no longer exists gets an
 * `obsolete` receipt rather than an infinite retry, matching
 * `inbox.on-review-created`'s treatment of a vanished review.
 */
export async function handleNotificationInboxItemCreated(
  deps: NotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
  const logger = deps.logger
  const correlationId = event.correlationId ?? undefined
  const payload = parseInboxItemCreated(event)

  const facts = await deps.inboxItemLookup.findInboxItemFacts(
    brandInboxItemId(payload.inboxItemId),
    brandOrganizationId(payload.organizationId),
  )
  if (facts === null) {
    logger.warn(
      { correlationId, consumerName: ON_INBOX_ITEM_CREATED_CONSUMER },
      'notification.on-inbox-item-created: inbox item is gone — marking obsolete',
    )
    await deps.receipts.insertReceipt(
      event.eventId,
      ON_INBOX_ITEM_CREATED_CONSUMER,
      'obsolete',
    )
    return { status: 'obsolete' }
  }

  const outcome = await fanoutInboxItemNotifications(deps, {
    inboxItemId: payload.inboxItemId,
    organizationId: payload.organizationId,
    propertyId: payload.propertyId ?? facts.propertyId,
    sourceType: payload.sourceType ?? facts.sourceType,
    eventId: event.eventId,
    correlationId: event.correlationId ?? null,
    // Relay delivery is at-least-once and the receipt is written after the
    // enqueue; the deterministic id makes the redelivery in that window a
    // no-op instead of a second notification job.
    jobIdScope: event.eventId,
  })

  // A source that never notifies anybody is a permanent property of the event,
  // not a transient failure: record it as processed-without-effect so
  // redelivery short-circuits on the receipt. Everything else (including "no
  // recipients", which the fan-out already warns about) is 'applied' — the
  // consumer did all the work the event admits.
  const status =
    outcome.kind === 'skipped' && outcome.reason === 'unknown_source'
      ? 'obsolete'
      : 'applied'

  await deps.receipts.insertReceipt(event.eventId, ON_INBOX_ITEM_CREATED_CONSUMER, status)

  logger.info(
    {
      correlationId,
      consumerName: ON_INBOX_ITEM_CREATED_CONSUMER,
      status,
      recipients: outcome.kind === 'enqueued' ? outcome.recipients : 0,
      skippedReason: outcome.kind === 'skipped' ? outcome.reason : undefined,
    },
    'notification.on-inbox-item-created completed',
  )

  return { status }
}

/**
 * Register notification consumers with the outbox dispatcher.
 * Called during worker startup (after bootstrap).
 */
export function registerNotificationConsumers(
  registry: ConsumerRegistry,
  deps: NotificationConsumerDeps,
): void {
  const { registerConsumer } = registry
  // Consumer names MUST stay string literals here — both governance catalogue
  // guards discover durable consumers by scanning registerConsumer calls.
  registerConsumer({
    eventType: 'inbox.inbox_item.created',
    consumerName: 'notification.on-inbox-item-created',
    module: 'notification.outbox-consumers',
    handler: (event) => handleNotificationInboxItemCreated(deps, event),
  })
  deps.logger.info(
    'Notification consumers registered with outbox dispatcher (1 consumer)',
  )
}
