import { GBP_PUSH_SYNC_INITIATOR_ID } from '#/contexts/review/application/public-api'
import type { TargetedGoogleReviewQueuePort } from '#/contexts/review/application/public-api'
import type { ConsumerEvent, ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { validateEventPayload } from '#/shared/events/schema-registry'

export const GBP_REVIEW_PUSH_DISPATCH_CONSUMER =
  'integration.google-review-push-dispatch' as const

type GoogleReviewPushAcceptedPayload = Readonly<{
  organizationId: string
  propertyId: string
  connectionId: string
  sourceEpoch: number
  referenceRef: string | null
  notificationKind: 'NEW_REVIEW' | 'UPDATED_REVIEW' | 'REVIEW_CHANGED'
  occurredAt: string
}>

/**
 * Converts the durable, identifier-only ingress fact into Review-owned work.
 * Queue deduplication and the consumer receipt use the same event identity, so
 * an ambiguous queue response is safe to replay.
 */
export async function handleGoogleReviewPushAccepted(
  deps: Readonly<{
    queue: TargetedGoogleReviewQueuePort
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>,
  event: ConsumerEvent,
): Promise<Readonly<{ status: 'applied' }>> {
  const payload = validateEventPayload(
    'integration.google_review_push.accepted',
    event.eventVersion,
    event.payload,
  ) as GoogleReviewPushAcceptedPayload | undefined
  if (
    !payload ||
    event.eventType !== 'integration.google_review_push.accepted' ||
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId ||
    payload.propertyId !== event.sourceAggregateId
  ) {
    throw new Error('Google review push envelope attribution mismatch')
  }

  const jobId = `gbp-push-${event.eventId}`
  await deps.queue.addTargetedFetchJob(
    {
      mode: 'targeted',
      organizationId: payload.organizationId,
      propertyId: payload.propertyId,
      connectionId: payload.connectionId,
      sourceEpoch: payload.sourceEpoch,
      referenceRef: payload.referenceRef,
      deliveryId: event.eventId,
      initiator: { kind: 'system', id: GBP_PUSH_SYNC_INITIATOR_ID },
      correlationId: jobId,
    },
    { jobId },
  )
  await deps.receipts.insertReceipt(
    event.eventId,
    GBP_REVIEW_PUSH_DISPATCH_CONSUMER,
    'applied',
  )
  return { status: 'applied' }
}

export function registerGoogleReviewPushDispatchConsumer(
  registry: ConsumerRegistry,
  deps: Readonly<{
    queue: TargetedGoogleReviewQueuePort
    receipts: Pick<OutboxRepository, 'insertReceipt'>
  }>,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'integration.google_review_push.accepted',
    consumerName: 'integration.google-review-push-dispatch',
    module: 'integration.google-review-push-dispatch',
    handler: (event) => handleGoogleReviewPushAccepted(deps, event),
  })
}
