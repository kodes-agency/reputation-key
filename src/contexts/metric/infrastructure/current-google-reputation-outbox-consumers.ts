import { organizationId, propertyId } from '#/shared/domain/ids'
import { validateEventPayload } from '#/shared/events/schema-registry'
import {
  registerConsumer,
  type ConsumerEvent,
  type ConsumerResult,
} from '#/shared/outbox'
import type { CurrentGoogleReputationSnapshotStore } from '../application/ports/current-google-reputation-snapshot.port'

const EVENT_TYPE = 'review.google_reputation_snapshot.verified' as const

type VerifiedSnapshotPayload = Readonly<{
  organizationId: string
  propertyId: string
  sourceEpoch: number
  runId: string
  reviewCount: number
  averageRating: number | null
  evaluatedAt: string
  sourceAggregateVersion: string
}>

export const handleCurrentGoogleReputationSnapshot = async (
  store: CurrentGoogleReputationSnapshotStore,
  event: ConsumerEvent,
): Promise<ConsumerResult> => {
  if (event.eventType !== EVENT_TYPE) {
    throw new Error('Current Google reputation consumer received the wrong event type')
  }
  const payload = validateEventPayload(
    EVENT_TYPE,
    event.eventVersion,
    event.payload,
  ) as VerifiedSnapshotPayload
  if (
    payload.organizationId !== event.organizationId ||
    payload.propertyId !== event.propertyId
  ) {
    throw new Error('Current Google reputation envelope attribution mismatch')
  }
  if (event.sourceContext !== 'review' || event.sourceAggregateId !== payload.runId) {
    throw new Error('Current Google reputation source authority mismatch')
  }
  if (
    event.sourceAggregateVersion !== payload.sourceAggregateVersion ||
    event.occurredAt !== payload.evaluatedAt ||
    payload.sourceAggregateVersion !== payload.evaluatedAt
  ) {
    throw new Error('Current Google reputation source version mismatch')
  }
  const evaluatedAt = new Date(payload.evaluatedAt)
  if (Number.isNaN(evaluatedAt.getTime())) {
    throw new Error('Current Google reputation evaluatedAt is invalid')
  }
  const status = await store.applyVerifiedSnapshot({
    eventId: event.eventId,
    organizationId: organizationId(payload.organizationId),
    propertyId: propertyId(payload.propertyId),
    sourceEpoch: payload.sourceEpoch,
    runId: payload.runId,
    reviewCount: payload.reviewCount,
    averageRating: payload.averageRating,
    evaluatedAt,
  })
  return { status }
}

export const registerCurrentGoogleReputationConsumer = (
  store: CurrentGoogleReputationSnapshotStore,
): void => {
  // Keep these literals mechanically discoverable by the governance
  // catalogues. The store exports the same consumer name for its receipt.
  registerConsumer({
    eventType: 'review.google_reputation_snapshot.verified',
    consumerName: 'metric.current-google-reputation',
    module: 'metric.current-google-reputation',
    handler: (event) => handleCurrentGoogleReputationSnapshot(store, event),
  })
}
