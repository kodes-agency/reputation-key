// Durable grouped delivery for one atomic Inbox bulk-assignment completion.
// The completion fact is the replay boundary; bulk-linked per-item assignment
// facts remain activity history and deliberately do not notify independently.

import { z } from 'zod/v4'
import { registerConsumer, type ConsumerEvent } from '#/shared/outbox'
import type { OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import {
  inboxItemId,
  organizationId,
  propertyId,
  unbrand,
  userId,
} from '#/shared/domain/ids'
import type { UserLookupPort } from '../application/ports/user-lookup.port'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import { isSafeOpaqueIdentifier } from '#/shared/domain/safe-identifier'

export const ON_INBOX_BULK_ASSIGNMENT_COMPLETED_CONSUMER =
  'notification.on-inbox-bulk-assignment-completed' as const

export type BulkAssignmentNotificationConsumerDeps = Readonly<{
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

export async function handleNotificationBulkAssignmentCompleted(
  deps: BulkAssignmentNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' }>> {
  const payload = parse(event)
  const nextAssignee = payload.transitions[0]!.nextAssignee

  // A release has no next assignee. The actor already knows what they did and
  // AccountAdmins are not a substitute recipient, so it has no notification.
  if (nextAssignee !== null) {
    const org = organizationId(payload.organizationId)
    const actorRole = await deps.userLookup.findActorRole(userId(payload.userId), org)
    const byProperty = new Map<string, Transition[]>()
    for (const transition of payload.transitions) {
      const group = byProperty.get(transition.propertyId) ?? []
      group.push(transition)
      byProperty.set(transition.propertyId, group)
    }

    await Promise.all(
      [...byProperty.entries()].map(([property, transitions]) => {
        const inboxItemIds = transitions.map((transition) =>
          inboxItemId(transition.inboxItemId),
        )
        const recipient = userId(nextAssignee)
        return deps.queue.add(
          INSERT_NOTIFICATION_JOB_NAME,
          {
            userId: recipient,
            organizationId: org,
            propertyId: propertyId(property),
            type: 'inbox.bulk_assigned' as const,
            resourceType: 'inbox_item' as const,
            // Opens the first canonically sorted item; the copy and count make
            // clear that the row represents the whole Property-scoped group.
            resourceId: inboxItemIds[0]!,
            eventId: event.eventId,
            payload: {
              itemCount: transitions.length,
              ...(actorRole ? { actorRole } : {}),
            },
            audience: { kind: 'bulk_inbox_assignee' as const, inboxItemIds },
          },
          {
            jobId: `${event.eventId}-${unbrand(recipient)}-${property}`,
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
  deps: BulkAssignmentNotificationConsumerDeps,
): void {
  registerConsumer({
    eventType: 'inbox.inbox_items.bulk_assignment_completed',
    consumerName: 'notification.on-inbox-bulk-assignment-completed',
    module: 'notification.bulk-assignment-outbox-consumers',
    handler: (event) => handleNotificationBulkAssignmentCompleted(deps, event),
  })
}
