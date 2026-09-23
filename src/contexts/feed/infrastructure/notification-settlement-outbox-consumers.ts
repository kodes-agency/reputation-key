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
  portalId,
  propertyId,
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

/**
 * What the settled notices point at. Reply and Inbox notices are filed against
 * their Inbox item (ADR 0046, merged ADR 0022); a "choose a responsible
 * manager" request is filed against the Property or Portal that has the gap.
 */
type SettledResourceKind = 'inbox_item_by_review' | 'inbox_item' | 'property' | 'portal'

/** Which settling fact each subscribed event carries, and under what name. */
export const NOTIFICATION_SETTLEMENT_CONSUMERS = [
  {
    eventType: 'review.reply.approved',
    consumerName: 'notification.settle-on-review-reply-approved',
    fact: 'reply.decided',
    resource: 'inbox_item_by_review',
  },
  {
    eventType: 'review.reply.rejected',
    consumerName: 'notification.settle-on-review-reply-rejected',
    fact: 'reply.decided',
    resource: 'inbox_item_by_review',
  },
  {
    eventType: 'review.reply.published',
    consumerName: 'notification.settle-on-review-reply-published',
    fact: 'reply.published',
    resource: 'inbox_item_by_review',
  },
  {
    eventType: 'inbox.inbox_item.escalation_resolved',
    consumerName: 'notification.settle-on-inbox-escalation-resolved',
    fact: 'escalation.resolved',
    resource: 'inbox_item',
  },
  {
    eventType: 'inbox.handling_cycle.closed',
    consumerName: 'notification.settle-on-inbox-handling-cycle-closed',
    fact: 'handling_cycle.closed',
    resource: 'inbox_item',
  },
  // A selection change says what the scope is left with. Only one that leaves
  // somebody responsible closes the gap; one that leaves nobody opens a new
  // one, which the `responsibility_became_needed` routes announce.
  {
    eventType: 'property.responsible_managers.updated',
    consumerName: 'notification.settle-on-property-responsibility-restored',
    fact: 'property.responsibility_restored',
    resource: 'property',
    onlyWhenStaffed: true,
  },
  {
    eventType: 'portal.responsible_managers.updated',
    consumerName: 'notification.settle-on-portal-responsibility-restored',
    fact: 'portal.responsibility_restored',
    resource: 'portal',
    onlyWhenStaffed: true,
  },
] as const satisfies ReadonlyArray<
  Readonly<{
    eventType: string
    consumerName: string
    fact: SettlingFact
    resource: SettledResourceKind
    onlyWhenStaffed?: boolean
  }>
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
 * Whether this fact finishes work at all. A selection change says what the
 * scope is LEFT with: one that leaves nobody responsible opens a gap rather
 * than closing one, and the `responsibility_became_needed` routes announce it.
 */
const finishesWork = (
  route: SettlementRoute,
  payload: Readonly<Record<string, unknown>>,
): boolean => {
  if (!('onlyWhenStaffed' in route && route.onlyWhenStaffed)) return true
  const count = payload.assignmentCount
  return typeof count === 'number' && count > 0
}

/**
 * The resource the settled notices point at. `null` when it is gone: there is
 * nothing left to settle, and nothing to repair either.
 */
async function resolveResource(
  deps: NotificationSettlementConsumerDeps,
  route: SettlementRoute,
  payload: Readonly<Record<string, unknown>>,
  orgId: OrganizationId,
): Promise<string | null> {
  switch (route.resource) {
    case 'inbox_item_by_review':
      return deps.inboxItemLookup.findInboxItemByReviewId(
        reviewId(requiredString(payload, 'reviewId')),
        orgId,
      )
    case 'inbox_item':
      return inboxItemId(requiredString(payload, 'inboxItemId'))
    case 'property':
      return propertyId(requiredString(payload, 'propertyId'))
    case 'portal':
      return portalId(requiredString(payload, 'portalId'))
  }
}

export async function handleNotificationSettlementEvent(
  deps: NotificationSettlementConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
  const route = routeFor(event.eventType)
  const payload = parsePayload(event)
  const orgId = organizationId(requiredString(payload, 'organizationId'))
  // Valid evidence that finishes nothing: the rule ran and decided, so the
  // delivery is applied rather than obsolete.
  if (!finishesWork(route, payload)) {
    await deps.receipts.insertReceipt(event.eventId, route.consumerName, 'applied')
    return { status: 'applied' }
  }
  const resourceId = await resolveResource(deps, route, payload, orgId)
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
