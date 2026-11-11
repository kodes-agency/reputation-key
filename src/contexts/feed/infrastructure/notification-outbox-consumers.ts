// Durable notification delivery for `inbox.inbox_item.created`.
//
// The source transaction records an identifier-only outbox fact. This consumer
// resolves current recipients and copy facts, then writes one notice per
// recipient together with its receipt (`deliverNotices`). The sibling workflow
// consumers cover assignment, escalation, notes, and Reply lifecycle facts the
// same way. A redelivery finds the receipt claimed and writes nothing, so it
// cannot bump a notice's user-visible repeat count.
//
// Content-free: identifiers, an enum and counts only (ADR 0030 / BQC-7.3).

import type { ConsumerEvent, ConsumerRegistry } from '#/shared/outbox'
import type { ConsumerResult } from '#/shared/outbox/consumer-registry'
import { validateEventPayload } from '#/shared/events/schema-registry'
import {
  inboxItemId as brandInboxItemId,
  organizationId as brandOrganizationId,
} from '#/shared/domain/ids'
import {
  inboxItemCreatedNotices,
  type InboxFanoutDeps,
} from './inbox-notification-fanout'
import { deliverNotices, type NoticeDeliveryDeps } from '../notify/consumers.server'

const INBOX_ITEM_CREATED_EVENT = 'inbox.inbox_item.created' as const
export const ON_INBOX_ITEM_CREATED_CONSUMER =
  'notification.on-inbox-item-created' as const

export type NotificationConsumerDeps = InboxFanoutDeps & NoticeDeliveryDeps

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
): Promise<ConsumerResult> {
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
    return deliverNotices(deps, event, ON_INBOX_ITEM_CREATED_CONSUMER, [], {
      status: 'obsolete',
    })
  }

  const outcome = await inboxItemCreatedNotices(deps, {
    inboxItemId: payload.inboxItemId,
    organizationId: payload.organizationId,
    propertyId: payload.propertyId ?? facts.propertyId,
    sourceType: payload.sourceType ?? facts.sourceType,
    correlationId: event.correlationId ?? null,
  })

  // A source that never notifies anybody is a permanent property of the event,
  // not a transient failure: record it as processed-without-effect so
  // redelivery short-circuits on the receipt. Everything else (including
  // imported Google history, which is never announced, and "no recipients",
  // which the fan-out already warns about) is 'applied' — the consumer did all
  // the work the event admits.
  const status =
    outcome.kind === 'skipped' && outcome.reason === 'unknown_source'
      ? 'obsolete'
      : 'applied'

  const result = await deliverNotices(
    deps,
    event,
    ON_INBOX_ITEM_CREATED_CONSUMER,
    outcome.kind === 'notices' ? outcome.notices : [],
    { status },
  )

  logger.info(
    {
      correlationId,
      consumerName: ON_INBOX_ITEM_CREATED_CONSUMER,
      status: result.status,
      recipients: outcome.kind === 'notices' ? outcome.notices.length : 0,
      skippedReason: outcome.kind === 'skipped' ? outcome.reason : undefined,
    },
    'notification.on-inbox-item-created completed',
  )

  return result
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
  // Consumer names and modules stay string literals, or string constants this
  // file declares or imports: the registration guard reads them from source
  // (outbox-consumer-registration.test) and fails on anything it cannot read.
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
