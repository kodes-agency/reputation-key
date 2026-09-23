// Durable settlement for notices whose work has since been done.
//
// Every other notification consumer in Feed announces something. This one
// retires: when the fact that finishes the work arrives — a reply decided or
// published, an escalation resolved, a Handling Cycle closed, a responsible
// manager chosen again — it stamps the still-waiting rows about that resource
// and cancels the mail queued behind them.
//
// It writes through the repositories rather than queueing a job: settling is
// one bounded update per fact and carries no per-recipient decision, so a
// fan-out would only add a queue hop to the same write. The receipt is last,
// as everywhere else in Feed, and settling is idempotent — a row already
// resolved is not settled twice, so a redelivery cancels no newer mail.

import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import {
  inboxItemId,
  organizationId,
  reviewId,
  type OrganizationId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { NotificationRepositoryPort } from '../application/ports/notification-repository.port'
import type { NotificationEmailRepositoryPort } from '../application/ports/notification-email-repository.port'
import type { InboxItemLookupPort } from '../application/ports/notification-inbox-item-lookup.port'
import {
  SETTLED_EMAIL_REASON,
  settledNotificationTypes,
  type SettlingFact,
} from '../domain/notification-settlement'

/** Which settling fact each subscribed event carries, and under what name. */
export const NOTIFICATION_SETTLEMENT_CONSUMERS = [
  {
    eventType: 'review.reply.approved',
    consumerName: 'notification.settle-on-review-reply-approved',
    fact: 'reply.decided',
  },
  {
    eventType: 'review.reply.rejected',
    consumerName: 'notification.settle-on-review-reply-rejected',
    fact: 'reply.decided',
  },
  {
    eventType: 'review.reply.published',
    consumerName: 'notification.settle-on-review-reply-published',
    fact: 'reply.published',
  },
  {
    eventType: 'inbox.inbox_item.escalation_resolved',
    consumerName: 'notification.settle-on-inbox-escalation-resolved',
    fact: 'escalation.resolved',
  },
  {
    eventType: 'inbox.handling_cycle.closed',
    consumerName: 'notification.settle-on-inbox-handling-cycle-closed',
    fact: 'handling_cycle.closed',
  },
] as const satisfies ReadonlyArray<
  Readonly<{ eventType: string; consumerName: string; fact: SettlingFact }>
>

type SettlementRoute = (typeof NOTIFICATION_SETTLEMENT_CONSUMERS)[number]

export type NotificationSettlementConsumerDeps = Readonly<{
  notifications: Pick<NotificationRepositoryPort, 'settleUnreadForResource'>
  emails: Pick<NotificationEmailRepositoryPort, 'cancelQueuedForNotifications'>
  inboxItemLookup: Pick<InboxItemLookupPort, 'findInboxItemByReviewId'>
  clock: () => Date
  logger: LoggerPort
  receipts: Pick<OutboxRepository, 'insertReceipt'>
}>

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (
  payload: Readonly<Record<string, unknown>>,
  key: string,
): string => {
  const value = payload[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`notification settlement payload is missing ${key}`)
  }
  return value
}

const routeFor = (eventType: string): SettlementRoute => {
  const route = NOTIFICATION_SETTLEMENT_CONSUMERS.find(
    (candidate) => candidate.eventType === eventType,
  )
  if (!route) {
    throw new Error(`unsupported notification settlement event: ${eventType}`)
  }
  return route
}

/**
 * The stored fact, proved to belong to the envelope that carried it. A payload
 * whose tenant or Property disagrees with the envelope is refused rather than
 * settling another Organization's notices.
 */
function parsePayload(event: ConsumerEvent): Readonly<Record<string, unknown>> {
  const parsed = validateEventPayload(event.eventType, event.eventVersion, event.payload)
  if (!isRecord(parsed)) {
    throw new Error('notification settlement payload must be an object')
  }
  if (parsed.organizationId !== event.organizationId) {
    throw new Error('notification settlement envelope attribution mismatch')
  }
  if ('propertyId' in parsed && parsed.propertyId !== event.propertyId) {
    throw new Error('notification settlement envelope attribution mismatch')
  }
  return parsed
}

/**
 * The resource the settled notices point at. Every notice a settling fact can
 * retire is filed against its Inbox item (ADR 0046, merged ADR 0022), so a
 * reply fact resolves its review to that item first. `null` when the item is
 * gone: there is nothing left to settle, and nothing to repair either.
 */
async function resolveResource(
  deps: NotificationSettlementConsumerDeps,
  event: ConsumerEvent,
  payload: Readonly<Record<string, unknown>>,
  orgId: OrganizationId,
): Promise<string | null> {
  if (event.eventType.startsWith('review.reply.')) {
    return deps.inboxItemLookup.findInboxItemByReviewId(
      reviewId(requiredString(payload, 'reviewId')),
      orgId,
    )
  }
  return inboxItemId(requiredString(payload, 'inboxItemId'))
}

export async function handleNotificationSettlementEvent(
  deps: NotificationSettlementConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
  const route = routeFor(event.eventType)
  const payload = parsePayload(event)
  const orgId = organizationId(requiredString(payload, 'organizationId'))
  const resourceId = await resolveResource(deps, event, payload, orgId)
  if (resourceId === null) {
    await deps.receipts.insertReceipt(event.eventId, route.consumerName, 'obsolete')
    return { status: 'obsolete' }
  }

  const resolvedAt = deps.clock()
  const settled = await deps.notifications.settleUnreadForResource({
    organizationId: orgId,
    types: settledNotificationTypes(route.fact),
    resourceId,
    resolvedAt,
  })
  if (settled.length > 0) {
    const cancelled = await deps.emails.cancelQueuedForNotifications(
      settled,
      orgId,
      SETTLED_EMAIL_REASON,
      resolvedAt,
    )
    deps.logger.info(
      {
        correlationId: event.correlationId ?? undefined,
        settled: settled.length,
        cancelled,
        fact: route.fact,
      },
      'Notices settled because their work is done',
    )
  }

  await deps.receipts.insertReceipt(event.eventId, route.consumerName, 'applied')
  return { status: 'applied' }
}

export function registerNotificationSettlementConsumers(
  registry: ConsumerRegistry,
  deps: NotificationSettlementConsumerDeps,
): void {
  for (const route of NOTIFICATION_SETTLEMENT_CONSUMERS) {
    registry.registerConsumer({
      eventType: route.eventType,
      consumerName: route.consumerName,
      module: 'notification.settlement-outbox-consumers',
      handler: (event) => handleNotificationSettlementEvent(deps, event),
    })
  }
}
