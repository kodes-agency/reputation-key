import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { AiAdmissionLane } from '../../domain/admission-lanes'

/** Why an analysis event waits in the backlog instead of running on delivery. */
export type AiReviewAnalysisBacklogOrigin =
  | 'historical_onboarding'
  | 'backfill'
  /** A live event whose background lane was busy when it was delivered. */
  | 'deferred_live'

export type AiReviewAnalysisBacklogEntry = Readonly<{
  eventEnvelopeId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  origin: AiReviewAnalysisBacklogOrigin
  priority: AiAdmissionLane
  attempts: number
  /** When the drainer first picked this entry; anchors its operation horizon. */
  firstStartedAtEpochMillis: number
}>

export type AiReviewAnalysisBacklogProgress = Readonly<{
  /** Waiting for their turn in the lane. */
  queued: number
  /** Claimed by a drainer right now. */
  inProgress: number
  /** Reviews with a ready analysis under the given fence. */
  analysed: number
  /** Reviews whose analysis settled, with or without a result. */
  settled: number
}>

export type AiReviewAnalysisBacklogPort = Readonly<{
  /** Idempotent by origin event. */
  enqueue(
    input: Readonly<{
      eventEnvelopeId: string
      organizationId: OrganizationId
      propertyId: PropertyId
      reviewId: ReviewId
      sourceEpoch: number
      sourceRevision: number
      analysisSequence: number
      origin: AiReviewAnalysisBacklogOrigin
      nowEpochMillis: number
    }>,
  ): Promise<void>
  /**
   * Claim ready entries: at most `perProperty` for each property, newest review
   * first (interactive-priority entries ahead of the rest), and at most
   * `limit` in total. A claim expires after `leaseMillis`, so a crashed drainer
   * cannot strand an entry.
   */
  claimReady(
    input: Readonly<{
      nowEpochMillis: number
      leaseMillis: number
      perProperty: number
      limit: number
    }>,
  ): Promise<ReadonlyArray<AiReviewAnalysisBacklogEntry>>
  /**
   * Claim the newest waiting entry for one review and mark it interactive.
   * Null when the review has nothing waiting or its entry is already claimed.
   */
  claimForReview(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      reviewId: ReviewId
      nowEpochMillis: number
      leaseMillis: number
    }>,
  ): Promise<AiReviewAnalysisBacklogEntry | null>
  /** The analysis settled (any outcome); the entry is done. */
  complete(
    input: Readonly<{ eventEnvelopeId: string; organizationId: OrganizationId }>,
  ): Promise<void>
  /** Return a claimed entry to the queue until `nextAttemptAtEpochMillis`. */
  reschedule(
    input: Readonly<{
      eventEnvelopeId: string
      organizationId: OrganizationId
      nextAttemptAtEpochMillis: number
      nowEpochMillis: number
    }>,
  ): Promise<void>
  readProgress(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      sourceEpoch: number
      reviewAnalysisEpoch: number
    }>,
  ): Promise<AiReviewAnalysisBacklogProgress>
  /** Whether a review has analysis waiting in the backlog. */
  hasPendingForReview(
    input: Readonly<{
      organizationId: OrganizationId
      propertyId: PropertyId
      reviewId: ReviewId
    }>,
  ): Promise<boolean>
}>
