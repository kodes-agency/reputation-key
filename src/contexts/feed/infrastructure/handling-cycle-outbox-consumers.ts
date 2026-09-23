// Durable notification admission for canonical Inbox Handling Cycle facts.
//
// The consumer and the insert-notification worker both resolve the exact
// current cycle/head. The first read prevents obviously obsolete fan-out; the
// delivery-time audience check closes the queue-delay race and revalidates the
// current Property/Portal Responsible Managers. Event and job payloads contain
// identifiers and workflow revisions only.
//
// A bulk reopen is one command, so it gets one notice per recipient per
// Property from its completion fact; the per-item reopen facts it stamps with
// its bulkId notify nobody.

import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import {
  inboxItemId,
  organizationId,
  propertyId,
  unbrand,
  userId,
  type OrganizationId,
  type UserId,
} from '#/shared/domain/ids'
import { isSafeOpaqueIdentifier } from '#/shared/domain/safe-identifier'
import type { NotificationType } from '../domain/notification-types'
import type {
  HandlingCycleRef,
  NotificationAudience,
} from '../application/notification-audience'
import type { HandlingCycleNotificationFacts } from '../application/ports/notification-inbox-item-lookup.port'
import { resolveHandlingCycleRecipients } from '../application/responsible-recipients'
import type { InboxFanoutDeps } from './inbox-notification-fanout'
import { buildInboxItemPayload } from './notification-payload-facts'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'

const OPENED_EVENT = 'inbox.handling_cycle.opened' as const
const REOPENED_EVENT = 'inbox.handling_cycle.reopened' as const
const BULK_REOPEN_COMPLETED_EVENT = 'inbox.inbox_items.bulk_reopen_completed' as const

export const ON_INBOX_HANDLING_CYCLE_OPENED_CONSUMER =
  'notification.on-inbox-handling-cycle-opened' as const
export const ON_INBOX_HANDLING_CYCLE_REOPENED_CONSUMER =
  'notification.on-inbox-handling-cycle-reopened' as const
export const ON_INBOX_BULK_REOPEN_COMPLETED_CONSUMER =
  'notification.on-inbox-bulk-reopen-completed' as const

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
  openedWithItem?: boolean
  reopenReason?: string
  bulkId?: string | null
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
 * notifications. Only a material Review revision maps from `opened`, and not
 * one the item was created with: nobody saw the earlier revision, so "New
 * review" already says it all. A reopen stamped with a bulkId is covered by
 * its bulk completion fact.
 */
function notificationTypeFor(payload: Parsed): NotificationType | null {
  if (payload.eventType === REOPENED_EVENT) {
    return payload.bulkId ? null : 'inbox.reopened'
  }
  return payload.openReason === 'material_revision_changed' &&
    payload.sourceType === 'review' &&
    payload.openedWithItem !== true
    ? 'review.updated'
    : null
}

/** The fields that pin one Handling Cycle, on a per-item or a bulk fact. */
type CycleIdentity = Readonly<{
  propertyId: string
  sourceType: 'review' | 'feedback'
  sourceId: string
  cycleNumber: number
  sourceRevision: number
  stateRevision: number
}>

function exactCurrent(
  cycle: CycleIdentity,
  facts: HandlingCycleNotificationFacts | null,
): facts is HandlingCycleNotificationFacts {
  return (
    facts !== null &&
    facts.propertyId === cycle.propertyId &&
    facts.sourceType === cycle.sourceType &&
    facts.sourceId === cycle.sourceId &&
    facts.currentCycleNumber === cycle.cycleNumber &&
    facts.currentSourceRevision === cycle.sourceRevision &&
    facts.stateRevision === cycle.stateRevision &&
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
  // owns initial arrival delivery, a bulk completion fact owns its reopens,
  // and legacy backfills never notify.
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
  const recipients = (await resolveHandlingCycleRecipients(deps, orgId, facts)).filter(
    (recipient) => recipient !== actorUserId,
  )
  const notificationPayload = await buildInboxItemPayload(deps, {
    inboxItemId: itemId,
    orgId,
    actorId: actorUserId,
    // Why it is open again, in the event's own closed enum. The free-text
    // explanation beside it stays in Inbox and never crosses (ADR 0046 r.8).
    reopenReason:
      notificationType === 'inbox.reopened' ? payload.reopenReason : undefined,
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

type BulkReopenedCycle = CycleIdentity & Readonly<{ inboxItemId: string }>

type BulkReopenPayload = Readonly<{
  organizationId: string
  userId: string
  bulkId: string
  reopened: ReadonlyArray<BulkReopenedCycle>
  count: number
}>

function parseBulkReopen(event: ConsumerEvent): BulkReopenPayload {
  const payload = validateEventPayload(
    BULK_REOPEN_COMPLETED_EVENT,
    event.eventVersion,
    event.payload,
  ) as BulkReopenPayload | undefined
  if (
    event.eventVersion !== 1 ||
    !payload ||
    payload.organizationId !== event.organizationId
  ) {
    throw new Error('Inbox bulk-reopen notification envelope attribution mismatch')
  }
  if (
    payload.count !== payload.reopened.length ||
    new Set(payload.reopened.map((cycle) => cycle.inboxItemId)).size !== payload.count ||
    !isSafeOpaqueIdentifier(payload.userId)
  ) {
    throw new Error('Inbox bulk-reopen completion contract is invalid')
  }
  return payload
}

type CurrentBulkCycle = Readonly<{
  cycle: BulkReopenedCycle
  facts: HandlingCycleNotificationFacts
}>

/** Keep only the cycles that are still their item's exact open head. */
async function currentBulkCycles(
  deps: HandlingCycleNotificationConsumerDeps,
  orgId: OrganizationId,
  reopened: ReadonlyArray<BulkReopenedCycle>,
): Promise<ReadonlyArray<CurrentBulkCycle>> {
  const current = await Promise.all(
    reopened.map(async (cycle) => {
      const facts = await deps.inboxItemLookup.findHandlingCycleNotificationFacts(
        inboxItemId(cycle.inboxItemId),
        orgId,
      )
      return exactCurrent(cycle, facts) ? { cycle, facts } : null
    }),
  )
  return current.filter((entry): entry is CurrentBulkCycle => entry !== null)
}

type RecipientGroup = Readonly<{
  recipient: UserId
  propertyId: string
  propertyName: string | null
  cycles: ReadonlyArray<BulkReopenedCycle>
}>

/**
 * Each item goes to whoever is responsible for it now — Property managers for
 * a review, Portal managers for private feedback — never to the actor. One
 * group per recipient per Property, cycles kept in canonical item order.
 */
async function groupByRecipientAndProperty(
  deps: HandlingCycleNotificationConsumerDeps,
  orgId: OrganizationId,
  actorUserId: UserId,
  current: ReadonlyArray<CurrentBulkCycle>,
): Promise<ReadonlyArray<RecipientGroup>> {
  const recipientsPerItem = await Promise.all(
    current.map(({ facts }) => resolveHandlingCycleRecipients(deps, orgId, facts)),
  )
  const groups = new Map<string, RecipientGroup>()
  current.forEach(({ cycle, facts }, index) => {
    for (const recipient of recipientsPerItem[index] ?? []) {
      if (recipient === actorUserId) continue
      const key = `${recipient}\u0000${cycle.propertyId}`
      const group = groups.get(key)
      groups.set(key, {
        recipient,
        propertyId: cycle.propertyId,
        propertyName: group?.propertyName ?? facts.propertyName,
        cycles: [...(group?.cycles ?? []), cycle],
      })
    }
  })
  return [...groups.values()]
}

const cycleRef = (cycle: BulkReopenedCycle): HandlingCycleRef => ({
  inboxItemId: inboxItemId(cycle.inboxItemId),
  sourceType: cycle.sourceType,
  sourceId: cycle.sourceId,
  cycleNumber: cycle.cycleNumber,
  sourceRevision: cycle.sourceRevision,
  stateRevision: cycle.stateRevision,
})

/** Durable grouped delivery for one atomic Inbox bulk reopen — exported for tests. */
export async function handleNotificationBulkReopenCompleted(
  deps: HandlingCycleNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
  const payload = parseBulkReopen(event)
  const orgId = organizationId(payload.organizationId)
  const actorUserId = userId(payload.userId)
  const current = await currentBulkCycles(deps, orgId, payload.reopened)
  if (current.length === 0) {
    await deps.receipts.insertReceipt(
      event.eventId,
      ON_INBOX_BULK_REOPEN_COMPLETED_CONSUMER,
      'obsolete',
    )
    return { status: 'obsolete' }
  }

  const groups = await groupByRecipientAndProperty(deps, orgId, actorUserId, current)
  const actorRole = await deps.userLookup.findActorRole(actorUserId, orgId)
  await Promise.all(
    groups.map((group) =>
      deps.queue.add(
        INSERT_NOTIFICATION_JOB_NAME,
        {
          userId: group.recipient,
          organizationId: orgId,
          propertyId: propertyId(group.propertyId),
          type: 'inbox.bulk_reopened' as const,
          resourceType: 'inbox_item' as const,
          // The first item in canonical order keys the row; its link opens
          // the Property's open queue, since the row stands for the group.
          resourceId: inboxItemId(group.cycles[0]!.inboxItemId),
          eventId: event.eventId,
          payload: {
            ...(group.propertyName === null ? {} : { propertyName: group.propertyName }),
            itemCount: group.cycles.length,
            ...(actorRole ? { actorRole } : {}),
          },
          audience: {
            kind: 'bulk_handling_cycle' as const,
            cycles: group.cycles.map(cycleRef),
            actorUserId,
          },
        },
        { jobId: `${event.eventId}-${unbrand(group.recipient)}-${group.propertyId}` },
      ),
    ),
  )

  // Receipt last, as for single cycles: a partial enqueue stays retryable.
  await deps.receipts.insertReceipt(
    event.eventId,
    ON_INBOX_BULK_REOPEN_COMPLETED_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

export function registerHandlingCycleNotificationConsumers(
  registry: ConsumerRegistry,
  deps: HandlingCycleNotificationConsumerDeps,
): void {
  const { registerConsumer } = registry
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
  registerConsumer({
    eventType: 'inbox.inbox_items.bulk_reopen_completed',
    consumerName: 'notification.on-inbox-bulk-reopen-completed',
    module: 'notification.handling-cycle-outbox-consumers',
    handler: (event) => handleNotificationBulkReopenCompleted(deps, event),
  })
}
