import type { ReviewCreated } from '#/contexts/review/application/public-api'
import type { Database } from '#/shared/db'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import { validateEventPayload } from '#/shared/events/schema-registry'
import type { ConsumerEvent, ConsumerRegistry } from '#/shared/outbox'
import type { RecordMetric } from '../application/use-cases/record-metric'
import type { ReviewRatingLookupPort } from '../application/ports/review-rating-lookup.port'
import { projectReviewCreatedMetric } from './event-handlers/on-review-created'

const PUBLIC_REPUTATION_CONSUMER = 'metric.public-reputation' as const

type ReviewCreatedPayload = Readonly<{
  reviewId: string
  organizationId: string
  propertyId: string
  platform?: string
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  occurredAt?: string
}>

function reviewCreatedDomainEvent(event: ConsumerEvent): ReviewCreated {
  const payload = validateEventPayload(
    event.eventType,
    event.eventVersion,
    event.payload,
  ) as ReviewCreatedPayload
  if (
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Public Reputation envelope attribution does not match its payload')
  }
  if (event.sourceContext !== 'review' || event.sourceAggregateId !== payload.reviewId) {
    throw new Error('Public Reputation source authority does not match the Review')
  }
  if (payload.platform !== undefined && payload.platform !== 'google') {
    throw new Error('Public Reputation source is not Google')
  }
  const sourceTime = payload.occurredAt ?? event.occurredAt ?? event.recordedAt
  const occurredAt =
    sourceTime === undefined ? new Date(Number.NaN) : new Date(sourceTime)
  if (Number.isNaN(occurredAt.getTime())) {
    throw new Error('Public Reputation event occurredAt is invalid')
  }
  return {
    _tag: 'review.created',
    eventId: event.eventId,
    correlationId: event.correlationId ?? null,
    reviewId: reviewId(payload.reviewId),
    organizationId: organizationId(payload.organizationId),
    propertyId: propertyId(payload.propertyId),
    platform: 'google',
    sourceEpoch: payload.sourceEpoch,
    sourceRevision: payload.sourceRevision,
    analysisSequence: payload.analysisSequence,
    occurredAt,
  }
}

export type PublicReputationMetricConsumerDeps = Readonly<{
  recordMetric: RecordMetric
  reviewRatingLookup: ReviewRatingLookupPort
  db: Database
}>

export function registerPublicReputationMetricConsumers(
  registry: ConsumerRegistry,
  deps: PublicReputationMetricConsumerDeps,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'review.created',
    consumerName: PUBLIC_REPUTATION_CONSUMER,
    module: PUBLIC_REPUTATION_CONSUMER,
    handler: async (event) => {
      const result = await projectReviewCreatedMetric(
        deps,
        reviewCreatedDomainEvent(event),
      )
      if (result === null) {
        await deps.db
          .insert(eventConsumerReceipts)
          .values({
            eventId: event.eventId,
            consumerName: PUBLIC_REPUTATION_CONSUMER,
            status: 'obsolete',
          })
          .onConflictDoNothing()
        return { status: 'obsolete' }
      }
      if (result.status === 'recorded') return { status: 'applied' }
      if (result.status === 'duplicate') return { status: 'duplicate' }
      throw new Error(`Public Reputation metric rejected: ${result.status}`)
    },
  })
}
