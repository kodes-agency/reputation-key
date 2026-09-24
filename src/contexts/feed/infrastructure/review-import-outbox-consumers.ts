// Feed notification surface — the one notice a Property's Google review
// history import produces.
//
// PR #597 stopped announcing imported history review by review: 260 "New
// review" rows for one location told nobody anything. This route puts one
// summary in its place (ADR 0046, amended 2026-09-24): what the import took
// in, and how much of it is still waiting for a reply.
//
// Two rules shape it.
//
//  1. It is NOT an emergency. Category `workflow_collaboration`, never urgent,
//     and a failure RepKey is already retrying by itself reaches nobody at
//     all — that is the flood in a different costume.
//  2. The unanswered count is read HERE, when the notice is built, not in the
//     import's own terminal transaction. An Inbox item is projected
//     asynchronously from `review.created`, so at the instant the snapshot run
//     became terminal the items it is about may not exist yet; a count taken
//     then would say "0 still need a reply" about 260 that do. The copy is
//     present-tense for the same reason.

import {
  organizationId,
  propertyId,
  unbrand,
  userId,
  type OrganizationId,
  type PropertyId,
  type UserId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import type { NotificationAudience } from '../application/notification-audience'
import type { InboxItemLookupPort } from '../application/ports/notification-inbox-item-lookup.port'
import type { ResponsibleManagerLookupPort } from '../application/ports/responsible-manager-lookup.port'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { NotificationImportFailureReason } from '../domain/notification-payload'
import type { NotificationJobEnqueuePort } from './inbox-notification-fanout'
import { INSERT_NOTIFICATION_JOB_NAME } from './jobs/insert-notification.job'
import {
  buildPropertyPayload,
  type PropertyPayloadDeps,
} from './notification-payload-facts'

export const ON_REVIEW_HISTORY_IMPORT_FINISHED_CONSUMER =
  'notification.on-review-history-import-finished' as const

/** Who asked for a Property's import, answered by the Integration context. */
export type PropertyImportInitiatorLookup = Readonly<{
  findPropertyImportInitiator: (
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<string | null>
}>

export type ReviewImportNotificationConsumerDeps = PropertyPayloadDeps &
  Readonly<{
    queue: NotificationJobEnqueuePort
    userLookup: Pick<UserLookupPort, 'findByRole'>
    responsibleManagers: Pick<ResponsibleManagerLookupPort, 'findForProperty'>
    inboxItemLookup: Pick<InboxItemLookupPort, 'countOpenReviewItemsForProperty'>
    importInitiators: PropertyImportInitiatorLookup
    logger: LoggerPort
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>

type ImportFinished = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  outcome: 'completed' | 'failed'
  reviewsObserved: number
  failureReason: NotificationImportFailureReason | null
}>

type Payload = Readonly<{
  organizationId: string
  propertyId: string
  outcome: 'completed' | 'failed'
  reviewsObserved: number
  failureReason: NotificationImportFailureReason | null
}>

function parse(event: ConsumerEvent): ImportFinished {
  const payload = validateEventPayload(
    'review.property_history_import.finished',
    event.eventVersion,
    event.payload,
  ) as Payload | undefined
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Review history import envelope attribution mismatch')
  }
  return {
    organizationId: organizationId(payload.organizationId),
    propertyId: propertyId(payload.propertyId),
    outcome: payload.outcome,
    reviewsObserved: payload.reviewsObserved,
    failureReason: payload.failureReason,
  }
}

/** Who hears about it, and the standing delivery rechecks before it lands. */
type Recipients = Readonly<{
  userIds: ReadonlyArray<UserId>
  audience: NotificationAudience
}>

/**
 * The person who asked, else the Property's responsible managers, else the
 * AccountAdmins. Each answer carries the audience that re-decides it at
 * delivery, so somebody who has since lost the Property hears nothing.
 */
async function resolveRecipients(
  deps: ReviewImportNotificationConsumerDeps,
  fact: ImportFinished,
): Promise<Recipients> {
  const initiator = await deps.importInitiators.findPropertyImportInitiator(
    fact.organizationId,
    fact.propertyId,
  )
  if (initiator !== null) {
    return { userIds: [userId(initiator)], audience: { kind: 'property_operator' } }
  }
  const managers = await deps.responsibleManagers.findForProperty(
    fact.organizationId,
    fact.propertyId,
  )
  if (managers.length > 0) {
    return {
      userIds: managers,
      audience: {
        kind: 'responsible_scope',
        scope: { kind: 'property', propertyId: unbrand(fact.propertyId) },
      },
    }
  }
  return {
    userIds: await deps.userLookup.findByRole(fact.organizationId, 'AccountAdmin'),
    audience: { kind: 'account_admin' },
  }
}

/**
 * How many of the Property's review items are still open. A read that fails
 * costs the sentence its second number, never the notice.
 */
async function countUnanswered(
  deps: ReviewImportNotificationConsumerDeps,
  fact: ImportFinished,
): Promise<number | null> {
  try {
    return await deps.inboxItemLookup.countOpenReviewItemsForProperty(
      unbrand(fact.propertyId),
      fact.organizationId,
    )
  } catch (err) {
    deps.logger.warn(
      { err },
      'notification payload: open review count failed, degrading copy',
    )
    return null
  }
}

export async function handleNotificationReviewHistoryImportFinished(
  deps: ReviewImportNotificationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
  const fact = parse(event)
  // A retryable failure is RepKey's problem, not the reader's.
  if (fact.outcome === 'failed' && fact.failureReason === 'temporary') {
    await deps.receipts.insertReceipt(
      event.eventId,
      ON_REVIEW_HISTORY_IMPORT_FINISHED_CONSUMER,
      'obsolete',
    )
    return { status: 'obsolete' }
  }

  const recipients = await resolveRecipients(deps, fact)
  if (recipients.userIds.length === 0) {
    deps.logger.warn(
      { correlationId: event.correlationId ?? undefined },
      'Review history import notification has no recipients',
    )
  } else {
    const [where, unanswered] = await Promise.all([
      buildPropertyPayload(deps, fact.organizationId, fact.propertyId),
      fact.outcome === 'completed' ? countUnanswered(deps, fact) : null,
    ])
    const payload = {
      ...where,
      importOutcome: fact.outcome,
      importedCount: fact.reviewsObserved,
      ...(unanswered === null ? {} : { unansweredCount: unanswered }),
      ...(fact.failureReason === null ? {} : { importFailureReason: fact.failureReason }),
    }
    await Promise.all(
      recipients.userIds.map((recipientId) =>
        deps.queue.add(
          INSERT_NOTIFICATION_JOB_NAME,
          {
            userId: recipientId,
            organizationId: fact.organizationId,
            propertyId: fact.propertyId,
            type: 'property.review_import_finished',
            resourceType: 'property',
            resourceId: unbrand(fact.propertyId),
            eventId: event.eventId,
            payload,
            audience: recipients.audience,
          },
          { jobId: `${event.eventId}-${recipientId}` },
        ),
      ),
    )
  }
  await deps.receipts.insertReceipt(
    event.eventId,
    ON_REVIEW_HISTORY_IMPORT_FINISHED_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

export function registerReviewImportNotificationConsumers(
  registry: ConsumerRegistry,
  deps: ReviewImportNotificationConsumerDeps,
): void {
  registry.registerConsumer({
    eventType: 'review.property_history_import.finished',
    consumerName: ON_REVIEW_HISTORY_IMPORT_FINISHED_CONSUMER,
    module: 'notification.review-import-outbox-consumers',
    handler: (event) => handleNotificationReviewHistoryImportFinished(deps, event),
  })
}
