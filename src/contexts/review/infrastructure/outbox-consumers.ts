// Review context — durable publication-intent delivery.
//
// A reply command commits review.reply.publication_requested in the same
// PostgreSQL transaction as its authorized reply state. This worker-only
// consumer independently admits that exact cycle to BullMQ if the request
// process stops before (or cannot complete) the direct fast-path admission.
//
// The queue add and PostgreSQL receipt cannot share a transaction. The
// deterministic reply+cycle job id closes that ambiguity: redelivery between
// add and receipt converges on the same BullMQ job.

import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  replyId,
  userId,
} from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ReplyRepository } from '../application/ports/reply.repository'
import type { ReplyQueuePort } from '../application/ports/reply-queue.port'
import type {
  CancelPublicationsForConnection,
  CancelPublicationsForProperty,
} from '../application/use-cases/cancel-publications'
import type { PropertyPublicationScopePort } from '../application/ports/property-publication-scope.port'
import { buildIdempotencyKey } from '../domain/reply-publication-workflow'

const EVENT_TYPE = 'review.reply.publication_requested' as const
export const ON_REPLY_PUBLICATION_REQUESTED_CONSUMER =
  'review.on-reply-publication-requested' as const
export const ON_GOOGLE_ACCOUNT_DISCONNECTED_CONSUMER =
  'review.on-google-account-disconnected' as const
export const ON_PROPERTY_ARCHIVED_CONSUMER = 'review.on-property-archived' as const

export type ReviewOutboxLogger = Pick<LoggerPort, 'info'>

export type ReplyPublicationDeliveryDeps = Readonly<{
  replyRepo: Pick<ReplyRepository, 'findById'>
  queue: ReplyQueuePort
  receipts: Pick<OutboxRepository, 'insertReceipt'>
}>

export type ReplyPublicationConsumerDeps = ReplyPublicationDeliveryDeps &
  Readonly<{
    logger: ReviewOutboxLogger
    /** BQC-3.8: disconnect cancellation of in-flight reply publications. */
    cancelPublicationsForConnection: CancelPublicationsForConnection
    /** Archive cancellation of one Property's in-flight reply publications. */
    cancelPublicationsForProperty: CancelPublicationsForProperty
    propertyPublicationScope: PropertyPublicationScopePort
  }>

type PublicationRequestedPayload = Readonly<{
  replyId: string
  reviewId: string
  propertyId: string
  organizationId: string
  userId: string
  publicationCycle: number
  sourceEpoch?: number
  materialReviewRevision?: number
  baseObservationRevision?: number
}>

function parsePublicationRequested(event: ConsumerEvent): PublicationRequestedPayload {
  const payload = validateEventPayload(EVENT_TYPE, event.eventVersion, event.payload) as
    PublicationRequestedPayload | undefined
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('reply publication intent envelope attribution mismatch')
  }
  return payload
}

async function receipt(
  deps: ReplyPublicationDeliveryDeps,
  eventId: string,
  status: 'applied' | 'obsolete',
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
  await deps.receipts.insertReceipt(
    eventId,
    ON_REPLY_PUBLICATION_REQUESTED_CONSUMER,
    status,
  )
  return { status }
}

/** Deliver one committed publication cycle, or settle stale work as obsolete. */
export async function handleReplyPublicationRequested(
  deps: ReplyPublicationDeliveryDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
  const payload = parsePublicationRequested(event)
  const current = await deps.replyRepo.findById(
    replyId(payload.replyId),
    organizationId(payload.organizationId),
  )

  // The reply may have been removed, cancelled, completed, failed, or moved
  // to a later authorization cycle before this event reached the worker. In
  // every case this intent is permanently inapplicable and must not enqueue.
  if (
    !current ||
    current.reviewId !== payload.reviewId ||
    current.publicationCycle !== payload.publicationCycle ||
    event.eventVersion !== 2 ||
    payload.sourceEpoch === undefined ||
    payload.materialReviewRevision === undefined ||
    payload.baseObservationRevision === undefined ||
    current.status !== 'approved' ||
    (current.publicationState !== 'authorized' && current.publicationState !== 'sending')
  ) {
    return receipt(deps, event.eventId, 'obsolete')
  }

  await deps.queue.addPublishJob(
    {
      replyId: payload.replyId,
      organizationId: payload.organizationId,
      publicationCycle: payload.publicationCycle,
      propertyId: payload.propertyId,
      sourceEpoch: payload.sourceEpoch,
      materialReviewRevision: payload.materialReviewRevision,
      baseObservationRevision: payload.baseObservationRevision,
      initiator: { kind: 'user', id: userId(payload.userId) },
    },
    {
      idempotencyKey: buildIdempotencyKey(payload.replyId, payload.publicationCycle),
    },
  )

  return receipt(deps, event.eventId, 'applied')
}

type GoogleAccountDisconnectedPayload = Readonly<{
  organizationId: string
  connectionId: string
}>

/**
 * A revoked Google connection must not leave a reply publication in flight:
 * every active publication (requested/authorized/sending) on the connection's
 * reviews is cancelled (publication_state → 'cancelled', status → 'draft', one
 * review.reply.publication_cancelled fact per reply). A publish job holding a
 * claim then loses its post-call re-read guard against the cancelled row and
 * returns without marking. Redelivery converges because the use case cancels
 * only what is still active.
 */
export async function handleGoogleAccountDisconnected(
  deps: ReplyPublicationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' }>> {
  const payload = event.payload as GoogleAccountDisconnectedPayload
  if (payload.organizationId !== event.organizationId) {
    throw new Error('google account disconnected envelope attribution mismatch')
  }
  const result = await deps.cancelPublicationsForConnection({
    organizationId: organizationId(payload.organizationId),
    connectionId: googleConnectionId(payload.connectionId),
    cause: 'disconnect',
  })
  deps.logger.info(
    { ...result },
    'integration.google_account.disconnected: reply publication cancellation complete',
  )
  await deps.receipts.insertReceipt(
    event.eventId,
    ON_GOOGLE_ACCOUNT_DISCONNECTED_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

type PropertyArchivedPayload = Readonly<{
  organizationId: string
  propertyId: string
}>

/**
 * An archived Property must not leave a reply publication in flight either:
 * the provider authorizer refuses its writes, and the worker would report
 * each refusal to the author as "Google rejected the reply". Every active
 * publication of its reviews is cancelled as a policy cancellation, like a
 * disconnect. A fact delivered after a Restore finds the Property active and
 * cancels nothing, so a reply approved since then is left alone.
 */
export async function handlePropertyArchived(
  deps: ReplyPublicationConsumerDeps,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' | 'obsolete' }>> {
  const payload = validateEventPayload(
    'property.archived',
    event.eventVersion,
    event.payload,
  ) as PropertyArchivedPayload | undefined
  if (
    !payload ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('property archived envelope attribution mismatch')
  }
  const orgId = organizationId(payload.organizationId)
  const pid = propertyId(payload.propertyId)
  const scope = await deps.propertyPublicationScope.getPublicationScope(orgId, pid)
  const status = scope?.active === true ? 'obsolete' : 'applied'
  if (status === 'applied') {
    const result = await deps.cancelPublicationsForProperty({
      organizationId: orgId,
      propertyId: pid,
      cause: 'policy',
    })
    deps.logger.info(
      { ...result },
      'property.archived: reply publication cancellation complete',
    )
  }
  await deps.receipts.insertReceipt(event.eventId, ON_PROPERTY_ARCHIVED_CONSUMER, status)
  return { status }
}

/** Worker-start registration; no consumer runtime is pulled into web builds. */
export function registerReplyPublicationConsumers(
  registry: ConsumerRegistry,
  deps: ReplyPublicationConsumerDeps,
): void {
  const { registerConsumer } = registry
  // Consumer identity literals are governance-scanned; keep them inline.
  registerConsumer({
    eventType: 'review.reply.publication_requested',
    consumerName: 'review.on-reply-publication-requested',
    module: 'review.outbox-consumers',
    handler: (event) => handleReplyPublicationRequested(deps, event),
  })
  registerConsumer({
    eventType: 'integration.google_account.disconnected',
    consumerName: 'review.on-google-account-disconnected',
    module: 'review.outbox-consumers',
    handler: (event) => handleGoogleAccountDisconnected(deps, event),
  })
  registerConsumer({
    eventType: 'property.archived',
    consumerName: 'review.on-property-archived',
    module: 'review.outbox-consumers',
    handler: (event) => handlePropertyArchived(deps, event),
  })
  deps.logger.info('Review consumers registered (3 consumers)')
}
