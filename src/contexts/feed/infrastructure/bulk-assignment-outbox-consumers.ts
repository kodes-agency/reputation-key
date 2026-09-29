// Durable grouped delivery for one atomic Inbox bulk-assignment completion.
// The completion fact is the replay boundary; bulk-linked per-item assignment
// facts remain activity history and deliberately do not notify independently.
// It tells the new assignee and each previous holder, once per Property.

import { z } from 'zod/v4'
import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import {
  inboxItemId,
  organizationId,
  propertyId,
  unbrand,
  userId,
} from '#/shared/domain/ids'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import {
  buildPropertyPayload,
  type PropertyPayloadDeps,
} from './notification-payload-facts'
import { isSafeOpaqueIdentifier } from '#/shared/domain/safe-identifier'

export const ON_INBOX_BULK_ASSIGNMENT_COMPLETED_CONSUMER =
  'notification.on-inbox-bulk-assignment-completed' as const

export type BulkAssignmentNotificationConsumerDeps = PropertyPayloadDeps &
  Readonly<{
    queue: NotificationJobEnqueuePort
    userLookup: Pick<UserLookupPort, 'findActorRole'>
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>

type Transition = Readonly<{
  inboxItemId: string
  propertyId: string
  previousAssignee: string | null
  nextAssignee: string | null
}>

type Payload = Readonly<{
  organizationId: string
  userId: string
  bulkId: string
  transitions: ReadonlyArray<Transition>
  count: number
  source: 'web'
  occurredAt: string
}>

const uuid = z.uuid()

function parse(event: ConsumerEvent): Payload {
  const payload = validateEventPayload(
    'inbox.inbox_items.bulk_assignment_completed',
    event.eventVersion,
    event.payload,
  ) as Payload | undefined
  if (!payload || payload.organizationId !== event.organizationId) {
    throw new Error('Inbox bulk-assignment envelope attribution mismatch')
  }
  if (
    event.eventVersion !== 1 ||
    payload.count !== payload.transitions.length ||
    !uuid.safeParse(payload.bulkId).success ||
    !isSafeOpaqueIdentifier(payload.organizationId) ||
    !isSafeOpaqueIdentifier(payload.userId)
  ) {
    throw new Error('Inbox bulk-assignment completion contract is invalid')
  }
  const sorted = [...payload.transitions].sort((left, right) =>
    left.inboxItemId.localeCompare(right.inboxItemId),
  )
  if (
    sorted.some(
      (transition, index) =>
        transition !== payload.transitions[index] ||
        !uuid.safeParse(transition.inboxItemId).success ||
        !uuid.safeParse(transition.propertyId).success ||
        (transition.nextAssignee !== null &&
          !isSafeOpaqueIdentifier(transition.nextAssignee)) ||
        (transition.previousAssignee !== null &&
          !isSafeOpaqueIdentifier(transition.previousAssignee)),
    )
  ) {
    throw new Error('Inbox bulk-assignment transitions are not canonical identifiers')
  }
  const nextAssignees = new Set(
    payload.transitions.map((transition) => transition.nextAssignee ?? 'released'),
  )
  if (nextAssignees.size !== 1) {
    throw new Error('Inbox bulk-assignment completion has multiple target assignees')
  }
  return payload
}

/** One grouped notice: one recipient, one Property, the items it stands for. */
type NoticeGroup = Readonly<{
  recipient: string
  propertyId: string
  type: 'inbox.bulk_assigned' | 'inbox.bulk_unassigned'
  inboxItemIds: ReadonlyArray<string>
}>

type RecipientGroup = Omit<NoticeGroup, 'type'>

/** Transitions grouped by recipient and Property, in canonical (item id) order. */
const groupBy = (
  transitions: ReadonlyArray<Transition>,
  recipientOf: (transition: Transition) => string,
): ReadonlyArray<RecipientGroup> => {
  const groups = new Map<
    string,
    { recipient: string; propertyId: string; inboxItemIds: string[] }
  >()
  for (const transition of transitions) {
    const recipient = recipientOf(transition)
    const key = `${recipient}\u0000${transition.propertyId}`
    const group = groups.get(key) ?? {
      recipient,
      propertyId: transition.propertyId,
      inboxItemIds: [],
    }
    group.inboxItemIds.push(transition.inboxItemId)
    groups.set(key, group)
  }
  return [...groups.values()]
}

/**
 * Who each bulk assignment is news to, one notice per recipient per Property.
 *
 * The new assignee, unless the actor took the items themselves. And, as a
 * single reassignment already does, whoever held an item before: they were
 * never told it had moved on (I15). A holder who moved their own items knows,
 * and a release has no new holder to hand anything to, so it stays silent
 * like a single-item release — the actor already knows, and AccountAdmins are
 * not a substitute recipient.
 */
const noticeGroups = (payload: Payload): ReadonlyArray<NoticeGroup> => {
  const nextAssignee = payload.transitions[0]!.nextAssignee
  if (nextAssignee === null) return []
  const assigned =
    nextAssignee === payload.userId
      ? []
      : groupBy(payload.transitions, () => nextAssignee).map((group) => ({
          ...group,
          type: 'inbox.bulk_assigned' as const,
        }))
  const displaced = payload.transitions.filter(
    (transition) =>
      transition.previousAssignee !== null &&
      transition.previousAssignee !== payload.userId &&
      transition.previousAssignee !== nextAssignee,
  )
  const unassigned = groupBy(displaced, (transition) => transition.previousAssignee!).map(
    (group) => ({ ...group, type: 'inbox.bulk_unassigned' as const }),
  )
  return [...assigned, ...unassigned]
}

export async function handleNotificationBulkAssignmentCompleted(
  deps: BulkAssignmentNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' }>> {
  const payload = parse(event)
  const groups = noticeGroups(payload)

  if (groups.length > 0) {
    const org = organizationId(payload.organizationId)
    const actorRole = await deps.userLookup.findActorRole(userId(payload.userId), org)
    await Promise.all(
      groups.map(async (group) => {
        const inboxItemIds = group.inboxItemIds.map(inboxItemId)
        const recipient = userId(group.recipient)
        const property = propertyId(group.propertyId)
        const where = await buildPropertyPayload(deps, org, property)
        const assigned = group.type === 'inbox.bulk_assigned'
        return deps.queue.add(
          INSERT_NOTIFICATION_JOB_NAME,
          {
            userId: recipient,
            organizationId: org,
            propertyId: property,
            type: group.type,
            resourceType: 'inbox_item' as const,
            // The first canonically sorted item is the row's resource identity;
            // its link opens a queue at this Property instead
            // (notificationLink), since the row stands for the whole group.
            resourceId: inboxItemIds[0]!,
            eventId: event.eventId,
            payload: {
              ...where,
              itemCount: inboxItemIds.length,
              ...(actorRole ? { actorRole } : {}),
            },
            // The new assignee is admitted for the items still theirs; a
            // previous holder no longer holds them, so they are admitted as
            // somebody who may still act on the Property.
            audience: assigned
              ? { kind: 'bulk_inbox_assignee' as const, inboxItemIds }
              : { kind: 'property_operator' as const },
          },
          {
            jobId: `${event.eventId}-${unbrand(recipient)}-${group.propertyId}${assigned ? '' : '-unassigned'}`,
          },
        )
      }),
    )
  }

  await deps.receipts.insertReceipt(
    event.eventId,
    ON_INBOX_BULK_ASSIGNMENT_COMPLETED_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

export function registerBulkAssignmentNotificationConsumer(
  registry: ConsumerRegistry,
  deps: BulkAssignmentNotificationConsumerDeps,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'inbox.inbox_items.bulk_assignment_completed',
    consumerName: 'notification.on-inbox-bulk-assignment-completed',
    module: 'notification.bulk-assignment-outbox-consumers',
    handler: (event) => handleNotificationBulkAssignmentCompleted(deps, event),
  })
}
