// Durable grouped delivery for one release of a member's Inbox assignments.
//
// When a member is offboarded, or loses the authority an assignment rested on,
// their items are unassigned. The per-item `inbox.inbox_item.unassigned` facts
// remain activity history and deliberately do not notify: the news is not that
// item #37 changed hands, it is that a pile of work at a Property now belongs
// to nobody. The grouped close fact is the replay boundary, and this consumer
// turns it into ONE notice per Property, to the people who now own that gap.

import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import {
  inboxItemId,
  organizationId,
  propertyId,
  unbrand,
  userId,
  type UserId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import { resolveResponsibleRecipients } from '../application/responsible-recipients'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import {
  buildPropertyPayload,
  type PropertyPayloadDeps,
} from './notification-payload-facts'

export const ON_INBOX_ASSIGNMENTS_RELEASED_CONSUMER =
  'notification.on-inbox-assignments-released' as const

export type AssignmentReleaseNotificationConsumerDeps = PropertyPayloadDeps &
  Readonly<{
    queue: NotificationJobEnqueuePort
    userLookup: Pick<UserLookupPort, 'findByRole'>
    responsibleManagers: ResponsibleManagerLookupPort
    logger: LoggerPort
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>

type Release = Readonly<{
  propertyId: string
  anchorInboxItemId: string
  count: number
}>

type Payload = Readonly<{
  organizationId: string
  userId: string | null
  releasedFrom: string
  releaseReason: 'member_offboarded' | 'member_became_ineligible'
  releases: ReadonlyArray<Release>
  count: number
}>

function parse(event: ConsumerEvent): Payload {
  const payload = validateEventPayload(
    'inbox.inbox_items.assignments_released',
    event.eventVersion,
    event.payload,
  ) as Payload | undefined
  if (!payload || payload.organizationId !== event.organizationId) {
    throw new Error('Inbox assignment-release envelope attribution mismatch')
  }
  const total = payload.releases.reduce((sum, release) => sum + release.count, 0)
  if (
    payload.count !== total ||
    new Set(payload.releases.map((release) => release.propertyId)).size !==
      payload.releases.length
  ) {
    throw new Error('Inbox assignment-release completion contract is invalid')
  }
  return payload
}

export async function handleNotificationAssignmentsReleased(
  deps: AssignmentReleaseNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' }>> {
  const payload = parse(event)
  const org = organizationId(payload.organizationId)
  const departing = userId(payload.releasedFrom)
  const actor = payload.userId === null ? null : userId(payload.userId)

  await Promise.all(
    payload.releases.map(async (release) => {
      const property = release.propertyId
      const scope = { kind: 'property', propertyId: property } as const
      const recipients = (await resolveResponsibleRecipients(deps, org, scope)).filter(
        // The departing member no longer owns this work, and the person who
        // released them already knows: nobody is told about their own action.
        (recipientId: UserId) => recipientId !== departing && recipientId !== actor,
      )
      if (recipients.length === 0) {
        deps.logger.warn(
          { correlationId: event.correlationId ?? undefined },
          'Inbox assignment-release notification has no recipients for a Property',
        )
        return
      }
      const where = await buildPropertyPayload(deps, org, propertyId(property))
      await Promise.all(
        recipients.map((recipientId) =>
          deps.queue.add(
            INSERT_NOTIFICATION_JOB_NAME,
            {
              userId: recipientId,
              organizationId: org,
              propertyId: propertyId(property),
              type: 'inbox.assignments_released' as const,
              resourceType: 'inbox_item' as const,
              // The row stands for the whole group; its link opens the
              // Property's open queue rather than this one item.
              resourceId: inboxItemId(release.anchorInboxItemId),
              eventId: event.eventId,
              payload: { ...where, itemCount: release.count },
              audience: { kind: 'responsible_scope' as const, scope },
            },
            { jobId: `${event.eventId}-${unbrand(recipientId)}-${property}` },
          ),
        ),
      )
    }),
  )

  await deps.receipts.insertReceipt(
    event.eventId,
    ON_INBOX_ASSIGNMENTS_RELEASED_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

export function registerAssignmentReleaseNotificationConsumer(
  registry: ConsumerRegistry,
  deps: AssignmentReleaseNotificationConsumerDeps,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'inbox.inbox_items.assignments_released',
    consumerName: ON_INBOX_ASSIGNMENTS_RELEASED_CONSUMER,
    module: 'notification.assignment-release-outbox-consumers',
    handler: (event) => handleNotificationAssignmentsReleased(deps, event),
  })
}
