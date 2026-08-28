// Review context — domain events
// Standards: docs/standards.md §1

import { newEventId } from '#/shared/domain/event-id'
import { assert } from '#/shared/domain/assert'
import type {
  ReviewId,
  ReplyId,
  PropertyId,
  OrganizationId,
  UserId,
} from '#/shared/domain/ids'
import type { ReviewPlatform } from './types'

const DATABASE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const PUBLICATION_CANCELLATION_CAUSES = new Set([
  'disconnect',
  'policy',
  'source_changed',
  'provider_truth',
])

export type ReviewCreated = Readonly<{
  _tag: 'review.created'
  eventId: string
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  platform: ReviewPlatform
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  // BQR-4.2 / ADR 0030: identifier-only — no raw reviewer/text on the bus.
  // BQC-1.2: rating removed — raw content resolves via authorized read.
  occurredAt: Date
  correlationId: string | null
}>
export const reviewCreated = (
  args: Omit<ReviewCreated, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): ReviewCreated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  assert(
    Number.isSafeInteger(args.sourceEpoch) && args.sourceEpoch >= 0,
    'sourceEpoch must be a nonnegative safe integer',
  )
  assert(
    Number.isSafeInteger(args.sourceRevision) && args.sourceRevision > 0,
    'sourceRevision must be a positive safe integer',
  )
  assert(
    Number.isSafeInteger(args.analysisSequence) && args.analysisSequence > 0,
    'analysisSequence must be a positive safe integer',
  )
  return {
    ...args,
    _tag: 'review.created',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

export type ReviewUpdated = Readonly<{
  _tag: 'review.updated'
  eventId: string
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  platform: ReviewPlatform
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  // BQR-4.2 / ADR 0030: identifier-only — no raw reviewer/text on the bus.
  // BQC-1.2: rating removed — raw content resolves via authorized read.
  occurredAt: Date
  correlationId: string | null
}>
export const reviewUpdated = (
  args: Omit<ReviewUpdated, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): ReviewUpdated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  assert(
    Number.isSafeInteger(args.sourceEpoch) && args.sourceEpoch >= 0,
    'sourceEpoch must be a nonnegative safe integer',
  )
  assert(
    Number.isSafeInteger(args.sourceRevision) && args.sourceRevision > 0,
    'sourceRevision must be a positive safe integer',
  )
  assert(
    Number.isSafeInteger(args.analysisSequence) && args.analysisSequence > 0,
    'analysisSequence must be a positive safe integer',
  )
  return {
    ...args,
    _tag: 'review.updated',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

export type ReviewExpired = Readonly<{
  _tag: 'review.expired'
  eventId: string
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  occurredAt: Date
  correlationId: string | null
}>
export const reviewExpired = (
  args: Omit<ReviewExpired, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): ReviewExpired => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    ...args,
    _tag: 'review.expired',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

export type ReviewSourceTransitioned = Readonly<{
  _tag: 'review.source_transitioned'
  eventId: string
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  change: 'source_expired' | 'provider_deleted'
  occurredAt: Date
  correlationId: string | null
}>

export const reviewSourceTransitioned = (
  args: Omit<ReviewSourceTransitioned, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): ReviewSourceTransitioned => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  assert(
    Number.isSafeInteger(args.sourceEpoch) && args.sourceEpoch >= 0,
    'sourceEpoch must be a nonnegative safe integer',
  )
  assert(
    Number.isSafeInteger(args.sourceRevision) && args.sourceRevision > 0,
    'sourceRevision must be a positive safe integer',
  )
  assert(
    Number.isSafeInteger(args.analysisSequence) && args.analysisSequence > 0,
    'analysisSequence must be a positive safe integer',
  )
  return {
    ...args,
    _tag: 'review.source_transitioned',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
  }
}
export type ReviewReplyPublished = Readonly<{
  _tag: 'review.reply.published'
  eventId: string
  replyId: ReplyId
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  userId: UserId | null
  authorId: UserId | null
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplyPublished = (
  args: Omit<ReviewReplyPublished, '_tag' | 'eventId' | 'correlationId' | 'source'> & {
    source?: 'web' | 'import'
    correlationId?: string | null
  },
): ReviewReplyPublished => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    ...args,
    _tag: 'review.reply.published',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
    source: args.source ?? 'web',
  }
}

export type ReviewReplySubmitted = Readonly<{
  _tag: 'review.reply.submitted'
  eventId: string
  replyId: ReplyId
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  userId: UserId
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplySubmitted = (
  args: Omit<ReviewReplySubmitted, '_tag' | 'eventId' | 'correlationId' | 'source'> & {
    source?: 'web' | 'import'
    correlationId?: string | null
  },
): ReviewReplySubmitted => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    ...args,
    _tag: 'review.reply.submitted',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
    source: args.source ?? 'web',
  }
}

export type ReviewReplyApproved = Readonly<{
  _tag: 'review.reply.approved'
  eventId: string
  replyId: ReplyId
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  userId: UserId
  authorId: UserId | null
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplyApproved = (
  args: Omit<ReviewReplyApproved, '_tag' | 'eventId' | 'correlationId' | 'source'> & {
    source?: 'web' | 'import'
    correlationId?: string | null
  },
): ReviewReplyApproved => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    ...args,
    _tag: 'review.reply.approved',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
    source: args.source ?? 'web',
  }
}

/**
 * Identifier-only durable command intent for one manager-authorized
 * publication cycle. This is deliberately separate from lifecycle/audit
 * facts: approval, edit-and-republish, and retry all produce the same worker
 * recovery contract without carrying reply text (ADR 0030).
 */
export type ReviewReplyPublicationRequested = Readonly<{
  _tag: 'review.reply.publication_requested'
  eventId: string
  replyId: ReplyId
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  userId: UserId
  publicationCycle: number
  sourceEpoch: number
  materialReviewRevision: number
  /** Google reply observation-head revision visible at authorization; zero
   * means no head existed. */
  baseObservationRevision: number
  occurredAt: Date
  correlationId: string | null
}>

export const reviewReplyPublicationRequested = (
  args: Omit<ReviewReplyPublicationRequested, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): ReviewReplyPublicationRequested => {
  assert(
    args.occurredAt instanceof Date && !Number.isNaN(args.occurredAt.getTime()),
    'occurredAt must be a valid Date',
  )
  assert(
    typeof args.organizationId === 'string' && args.organizationId.trim().length > 0,
    'organizationId must be nonempty',
  )
  assert(
    typeof args.userId === 'string' && args.userId.trim().length > 0,
    'userId must be nonempty',
  )
  assert(DATABASE_UUID_PATTERN.test(args.replyId), 'replyId must be a UUID')
  assert(DATABASE_UUID_PATTERN.test(args.reviewId), 'reviewId must be a UUID')
  assert(DATABASE_UUID_PATTERN.test(args.propertyId), 'propertyId must be a UUID')
  assert(
    Number.isSafeInteger(args.publicationCycle) && args.publicationCycle > 0,
    'publicationCycle must be a positive safe integer',
  )
  assert(
    Number.isSafeInteger(args.sourceEpoch) && args.sourceEpoch >= 0,
    'sourceEpoch must be a nonnegative safe integer',
  )
  assert(
    Number.isSafeInteger(args.materialReviewRevision) && args.materialReviewRevision > 0,
    'materialReviewRevision must be a positive safe integer',
  )
  assert(
    Number.isSafeInteger(args.baseObservationRevision) &&
      args.baseObservationRevision >= 0,
    'baseObservationRevision must be a nonnegative safe integer',
  )
  return {
    ...args,
    _tag: 'review.reply.publication_requested',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

export type ReviewReplyRejected = Readonly<{
  _tag: 'review.reply.rejected'
  eventId: string
  replyId: ReplyId
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  userId: UserId
  authorId: UserId | null
  reason: string | null
  source: 'web' | 'import'
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplyRejected = (
  args: Omit<ReviewReplyRejected, '_tag' | 'eventId' | 'correlationId' | 'source'> & {
    source?: 'web' | 'import'
    correlationId?: string | null
  },
): ReviewReplyRejected => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    ...args,
    _tag: 'review.reply.rejected',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
    source: args.source ?? 'web',
  }
}

export type ReviewReplyPublishFailed = Readonly<{
  _tag: 'review.reply.publish_failed'
  eventId: string
  replyId: ReplyId
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  authorId: UserId | null
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplyPublishFailed = (
  args: Omit<ReviewReplyPublishFailed, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): ReviewReplyPublishFailed => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    ...args,
    _tag: 'review.reply.publish_failed',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

// BQC-3.8: a publication in flight (requested/authorized/sending) was
// cancelled by policy or by Google account disconnect. The reply returns to
// draft and must be re-approved before any new publish.
export type ReviewReplyUpdated = Readonly<{
  _tag: 'review.reply.updated'
  eventId: string
  replyId: ReplyId
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  /** The user who edited the published reply text. */
  userId: UserId | null
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplyUpdated = (
  args: Omit<ReviewReplyUpdated, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): ReviewReplyUpdated => {
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    ...args,
    _tag: 'review.reply.updated',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

export type ReviewReplyPublicationCancelled = Readonly<{
  _tag: 'review.reply.publication_cancelled'
  eventId: string
  replyId: ReplyId
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  cause: 'disconnect' | 'policy' | 'source_changed' | 'provider_truth'
  occurredAt: Date
  correlationId: string | null
}>
export const reviewReplyPublicationCancelled = (
  args: Omit<ReviewReplyPublicationCancelled, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): ReviewReplyPublicationCancelled => {
  assert(
    args.occurredAt instanceof Date && !Number.isNaN(args.occurredAt.getTime()),
    'occurredAt must be a valid Date',
  )
  assert(
    typeof args.organizationId === 'string' && args.organizationId.trim().length > 0,
    'organizationId must be nonempty',
  )
  assert(DATABASE_UUID_PATTERN.test(args.replyId), 'replyId must be a UUID')
  assert(DATABASE_UUID_PATTERN.test(args.reviewId), 'reviewId must be a UUID')
  assert(DATABASE_UUID_PATTERN.test(args.propertyId), 'propertyId must be a UUID')
  assert(
    PUBLICATION_CANCELLATION_CAUSES.has(args.cause),
    'cause must be a valid publication cancellation cause',
  )
  return {
    ...args,
    _tag: 'review.reply.publication_cancelled',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

/** Identifier-only fact for one material Google reply observation. Provider
 * text remains in the Review-owned source-content lifecycle, never the bus. */
export type ReviewReplyObserved = Readonly<{
  _tag: 'review.reply.observed'
  eventId: string
  reviewId: ReviewId
  organizationId: OrganizationId
  propertyId: PropertyId
  observationRevision: number
  sourceEpoch: number
  materialReviewRevision: number
  change: 'added' | 'edited' | 'deleted' | 'unchanged'
  resolution: 'confirmed_on_google' | 'external_current_live' | 'diverged' | 'absent'
  provenance: 'repkey_confirmed' | 'external_or_unknown' | 'none'
  matchedReplyId: ReplyId | null
  matchedPublicationCycle: number | null
  occurredAt: Date
  correlationId: string | null
}>

function hasValidReviewReplyObservationSemantics(
  observation: Pick<
    ReviewReplyObserved,
    'change' | 'resolution' | 'provenance' | 'matchedReplyId' | 'matchedPublicationCycle'
  >,
): boolean {
  const hasMatch =
    observation.matchedReplyId !== null && observation.matchedPublicationCycle !== null
  const hasNoMatch =
    observation.matchedReplyId === null && observation.matchedPublicationCycle === null

  switch (observation.resolution) {
    case 'confirmed_on_google':
      return (
        observation.change !== 'deleted' &&
        observation.provenance === 'repkey_confirmed' &&
        hasMatch
      )
    case 'external_current_live':
      return (
        observation.change !== 'deleted' &&
        observation.provenance === 'external_or_unknown' &&
        hasNoMatch
      )
    case 'diverged':
      return (
        observation.change !== 'deleted' &&
        observation.provenance === 'external_or_unknown' &&
        hasNoMatch
      )
    case 'absent':
      return (
        observation.change === 'deleted' &&
        observation.provenance === 'none' &&
        hasNoMatch
      )
  }
}

export const reviewReplyObserved = (
  args: Omit<ReviewReplyObserved, '_tag' | 'eventId' | 'correlationId'> & {
    correlationId?: string | null
  },
): ReviewReplyObserved => {
  assert(
    args.occurredAt instanceof Date && !Number.isNaN(args.occurredAt.getTime()),
    'occurredAt must be a valid Date',
  )
  assert(
    typeof args.organizationId === 'string' && args.organizationId.trim().length > 0,
    'organizationId must be nonempty',
  )
  assert(DATABASE_UUID_PATTERN.test(args.reviewId), 'reviewId must be a UUID')
  assert(DATABASE_UUID_PATTERN.test(args.propertyId), 'propertyId must be a UUID')
  if (args.matchedReplyId !== null) {
    assert(
      DATABASE_UUID_PATTERN.test(args.matchedReplyId),
      'matchedReplyId must be a UUID',
    )
  }
  assert(
    Number.isSafeInteger(args.observationRevision) && args.observationRevision > 0,
    'observationRevision must be a positive safe integer',
  )
  assert(
    Number.isSafeInteger(args.sourceEpoch) && args.sourceEpoch >= 0,
    'sourceEpoch must be a nonnegative safe integer',
  )
  assert(
    Number.isSafeInteger(args.materialReviewRevision) && args.materialReviewRevision > 0,
    'materialReviewRevision must be a positive safe integer',
  )
  assert(
    (args.matchedReplyId === null) === (args.matchedPublicationCycle === null),
    'matched Reply and publication cycle must be present together',
  )
  if (args.matchedPublicationCycle !== null) {
    assert(
      Number.isSafeInteger(args.matchedPublicationCycle) &&
        args.matchedPublicationCycle > 0,
      'matchedPublicationCycle must be a positive safe integer',
    )
  }
  assert(
    hasValidReviewReplyObservationSemantics(args),
    'review reply observation semantics are invalid',
  )
  return {
    ...args,
    _tag: 'review.reply.observed',
    eventId: newEventId(),
    correlationId: args.correlationId ?? null,
  }
}

/** Content-minimal provider aggregate proven by a completed main scan,
 * confirmation scan, and bounded Review reconciliation. */
export type ReviewGoogleReputationSnapshotVerified = Readonly<{
  _tag: 'review.google_reputation_snapshot.verified'
  eventId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceEpoch: number
  runId: string
  reviewCount: number
  averageRating: number | null
  evaluatedAt: Date
  sourceAggregateVersion: string
  occurredAt: Date
  correlationId: string | null
}>

export const reviewGoogleReputationSnapshotVerified = (
  args: Omit<
    ReviewGoogleReputationSnapshotVerified,
    '_tag' | 'eventId' | 'sourceAggregateVersion' | 'correlationId'
  > & { correlationId?: string | null },
): ReviewGoogleReputationSnapshotVerified => {
  assert(DATABASE_UUID_PATTERN.test(args.runId), 'runId must be a UUID')
  assert(
    Number.isSafeInteger(args.sourceEpoch) && args.sourceEpoch >= 0,
    'sourceEpoch must be a nonnegative safe integer',
  )
  assert(
    Number.isSafeInteger(args.reviewCount) &&
      args.reviewCount >= 0 &&
      args.reviewCount <= 10_000,
    'reviewCount must be a bounded nonnegative safe integer',
  )
  assert(
    (args.reviewCount === 0 && args.averageRating === null) ||
      (args.reviewCount > 0 &&
        args.averageRating !== null &&
        Number.isFinite(args.averageRating) &&
        args.averageRating >= 0 &&
        args.averageRating <= 5),
    'averageRating must match the provider review count',
  )
  assert(
    args.evaluatedAt instanceof Date && Number.isFinite(args.evaluatedAt.getTime()),
    'evaluatedAt must be a valid Date',
  )
  assert(
    args.occurredAt instanceof Date && Number.isFinite(args.occurredAt.getTime()),
    'occurredAt must be a valid Date',
  )
  assert(
    args.occurredAt.getTime() === args.evaluatedAt.getTime(),
    'occurredAt must equal evaluatedAt',
  )
  return {
    ...args,
    _tag: 'review.google_reputation_snapshot.verified',
    eventId: newEventId(),
    sourceAggregateVersion: args.evaluatedAt.toISOString(),
    occurredAt: args.occurredAt,
    correlationId: args.correlationId ?? null,
  }
}

export type ReviewEvent =
  | ReviewCreated
  | ReviewUpdated
  | ReviewExpired
  | ReviewSourceTransitioned
  | ReviewReplyPublished
  | ReviewReplySubmitted
  | ReviewReplyApproved
  | ReviewReplyPublicationRequested
  | ReviewReplyRejected
  | ReviewReplyPublishFailed
  | ReviewReplyUpdated
  | ReviewReplyPublicationCancelled
  | ReviewReplyObserved
  | ReviewGoogleReputationSnapshotVerified
