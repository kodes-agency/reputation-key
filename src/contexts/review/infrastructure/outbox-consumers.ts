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

import { registerConsumer, type ConsumerEvent } from '#/shared/outbox'
import type { OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'
import { organizationId, replyId, userId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { ReplyRepository } from '../application/ports/reply.repository'
import type { ReplyQueuePort } from '../application/ports/reply-queue.port'
import { buildIdempotencyKey } from '../domain/reply-publication-workflow'

const EVENT_TYPE = 'review.reply.publication_requested' as const
export const ON_REPLY_PUBLICATION_REQUESTED_CONSUMER =
  'review.on-reply-publication-requested' as const

export type ReviewOutboxLogger = Pick<LoggerPort, 'info'>

export type ReplyPublicationDeliveryDeps = Readonly<{
  replyRepo: Pick<ReplyRepository, 'findById'>
  queue: ReplyQueuePort
  receipts: Pick<OutboxRepository, 'insertReceipt'>
}>

export type ReplyPublicationConsumerDeps = ReplyPublicationDeliveryDeps &
  Readonly<{
    logger: ReviewOutboxLogger
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

/** Worker-start registration; no consumer runtime is pulled into web builds. */
export function registerReplyPublicationConsumers(
  deps: ReplyPublicationConsumerDeps,
): void {
  // Consumer identity literals are governance-scanned; keep them inline.
  registerConsumer({
    eventType: 'review.reply.publication_requested',
    consumerName: 'review.on-reply-publication-requested',
    module: 'review.outbox-consumers',
    handler: (event) => handleReplyPublicationRequested(deps, event),
  })
  deps.logger.info('Review reply-publication recovery consumer registered')
}
