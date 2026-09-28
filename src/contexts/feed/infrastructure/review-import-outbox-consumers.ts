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
//
//     Reading it here only moves the race: this fact is dispatched alongside
//     the import's last review facts, and a reply observation that overtook
//     its item waits out a retry backoff before it closes that item. So the
//     count waits until every review fact recorded before this one has
//     reached the Inbox, retrying the dispatch meanwhile. Past a horizon the
//     notice goes out without the number: a stuck projection is somebody
//     else's alarm, and a wrong number is worse than none.

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
    responsibleManagers: Pick<
      ResponsibleManagerLookupPort,
      'findForProperty' | 'isEligibleForProperty'
    >
    inboxItemLookup: Pick<
      InboxItemLookupPort,
      'countOpenReviewItemsForProperty' | 'hasPendingReviewProjections'
    >
    importInitiators: PropertyImportInitiatorLookup
    logger: LoggerPort
    receipts: Pick<OutboxRepository, 'insertReceipt'>
    clock: () => Date
  }>

/**
 * How long the summary waits for the import's review facts to reach the Inbox.
 * The dispatch retries at about 30 s, 1, 2, 4 and 8 minutes, so this covers
 * five waits; a projection still missing after that is stuck, not in flight.
 */
export const REVIEW_IMPORT_SUMMARY_SETTLE_HORIZON_MS = 15 * 60_000

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
 * The person who asked while still eligible, else the Property's responsible
 * managers, else the AccountAdmins. Each answer carries the audience that
 * re-decides it at delivery, so somebody who has since lost the Property hears
 * nothing. The initiator is checked here as well: delivery would drop an
 * initiator who was removed or demoted, and nobody else would hear either.
 */
async function resolveRecipients(
  deps: ReviewImportNotificationConsumerDeps,
  fact: ImportFinished,
): Promise<Recipients> {
  const initiator = await deps.importInitiators.findPropertyImportInitiator(
    fact.organizationId,
    fact.propertyId,
  )
  if (
    initiator !== null &&
    (await deps.responsibleManagers.isEligibleForProperty(
      fact.organizationId,
      fact.propertyId,
      userId(initiator),
    ))
  ) {
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
 * Whether the count may be taken now. `wait` throws, so the dispatch retries
 * this event; `skip` sends the notice without the number.
 */
async function settlement(
  deps: ReviewImportNotificationConsumerDeps,
  fact: ImportFinished,
  recordedAt: Date | null,
): Promise<'count' | 'wait' | 'skip'> {
  // An envelope from before recordedAt existed has nothing to wait against.
  if (recordedAt === null) return 'count'
  const pending = await deps.inboxItemLookup.hasPendingReviewProjections(
    unbrand(fact.propertyId),
    fact.organizationId,
    recordedAt,
  )
  if (!pending) return 'count'
  const waited = deps.clock().getTime() - recordedAt.getTime()
  return waited < REVIEW_IMPORT_SUMMARY_SETTLE_HORIZON_MS ? 'wait' : 'skip'
}

/**
 * How many of the Property's review items are still open. A read that fails
 * costs the sentence its second number, never the notice.
 */
async function countUnanswered(
  deps: ReviewImportNotificationConsumerDeps,
  fact: ImportFinished,
  recordedAt: Date | null,
): Promise<number | null> {
  let decision: 'count' | 'wait' | 'skip'
  try {
    decision = await settlement(deps, fact, recordedAt)
  } catch (err) {
    deps.logger.warn(
      { err },
      'notification payload: import projection check failed, degrading copy',
    )
    return null
  }
  if (decision === 'wait') {
    throw new Error(
      'Review history import summary is waiting: the import is still reaching the Inbox',
    )
  }
  if (decision === 'skip') {
    deps.logger.warn(
      { settleHorizonMs: REVIEW_IMPORT_SUMMARY_SETTLE_HORIZON_MS },
      'notification payload: import projections never settled, degrading copy',
    )
    return null
  }
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
      fact.outcome === 'completed'
        ? countUnanswered(
            deps,
            fact,
            event.recordedAt === undefined ? null : new Date(event.recordedAt),
          )
        : null,
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
