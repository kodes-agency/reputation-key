import { replyScopeEffects } from '#/contexts/reputation/public-api'
import type { Database } from '#/shared/db'
import { reviewCreated, reviewUpdated } from '../domain/review-events'
import type { Review } from '../domain/review-types'
import { createAtomicReviewCommandStore } from './review-command-store.server'
import { createReviewRepository } from './review-repository.server'

// Real time without the ambient-clock spelling the production guards ban.
const wallClock = () => new Date(performance.timeOrigin + performance.now())

export function testReviewCommandStore(db: Database) {
  return createAtomicReviewCommandStore(
    db,
    wallClock,
    undefined,
    undefined,
    replyScopeEffects,
  )
}

export function testReviewRepository(db: Database) {
  return createReviewRepository(db, wallClock, undefined, replyScopeEffects)
}

function eventFields(persisted: Review, occurredAt: Date) {
  return {
    reviewId: persisted.id,
    propertyId: persisted.propertyId,
    organizationId: persisted.organizationId,
    platform: persisted.platform,
    sourceEpoch: persisted.sourceEpoch,
    sourceRevision: persisted.sourceRevision,
    analysisSequence: persisted.analysisSequence,
    occurredAt,
  }
}

export const createdEvent = (occurredAt: Date) => (persisted: Review) =>
  reviewCreated(eventFields(persisted, occurredAt))

export const updatedEvent = (occurredAt: Date) => (persisted: Review) =>
  reviewUpdated(eventFields(persisted, occurredAt))
