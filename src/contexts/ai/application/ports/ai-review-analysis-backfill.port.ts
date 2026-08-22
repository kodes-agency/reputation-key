import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'

/**
 * Store port for the audited operator review-analysis backfill
 * (`ops:ai-reanalyze`).
 *
 * The whole backfill runs inside ONE session, and the session holds an
 * exclusive lock on the property row for its entire lifetime. That is what
 * makes contiguity a property of the design rather than of luck:
 * `lock_review_ai_analysis_head_v1` takes the same row lock, so no concurrent
 * review upsert can interleave an allocation between the head read and the last
 * event this backfill emits. The sequences handed out are therefore exactly
 * `head + 1 … head + n`, and every one of them carries an emitted event —
 * no hole can reach `consume_ai_review_event_v1`, which stalls its cursor
 * permanently on the first one.
 */
export type ReviewAnalysisBackfillStorePort = Readonly<{
  runExclusive: <T>(
    input: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
    run: (session: ReviewAnalysisBackfillSession) => Promise<T>,
  ) => Promise<T>
}>

/** The live merchant enablement head, or null when AI was never enabled here. */
export type ReviewAnalysisBackfillEnablement = Readonly<{
  state: string
  capabilities: ReadonlyArray<string>
  authorizedSourceEpoch: number
  reviewAnalysisEpoch: number
  analysisStartSequence: number
  stateVersion: number
}>

export type ReviewAnalysisBackfillContext = Readonly<{
  /** `properties.source_epoch`, read under the exclusive lock. */
  propertySourceEpoch: number
  propertyActive: boolean
  enablement: ReviewAnalysisBackfillEnablement | null
  /** `review_ai_analysis_heads.head_sequence` for the property's source epoch. */
  analysisHeadSequence: number
  /** Reviews eligible for re-analysis, before `--batch-size` caps the run. */
  eligibleReviewCount: number
  /**
   * `ai_property_daily_aggregates` rows already built for the LIVE
   * `(source_epoch, review_analysis_epoch)` pair. Reads pin to the
   * enablement's current epoch, so bumping it makes exactly these rows
   * historical — the plan says so before the operator applies, not after.
   */
  existingDailyAggregateRowCount: number
}>

/**
 * One review to replay. `storedAnalysisSequence` is the sequence its LAST
 * analysis event carried; it is reported so the plan can show how far the
 * stored sequences drift from contiguous, and is never reused as an event
 * sequence.
 */
export type ReviewAnalysisBackfillCandidate = Readonly<{
  reviewId: ReviewId
  sourceRevision: number
  storedAnalysisSequence: number
}>

export type ReviewAnalysisWatermarkReposition = Readonly<{
  sourceEpoch: number
  analysisStartSequence: number
  reviewAnalysisEpoch: number
  stateVersion: number
}>

export type ReviewAnalysisBackfillSession = Readonly<{
  readContext: () => Promise<ReviewAnalysisBackfillContext>
  /** Deterministic order (reviewed_at, id) so a capped run is reproducible. */
  listCandidates: (
    limit: number,
  ) => Promise<ReadonlyArray<ReviewAnalysisBackfillCandidate>>
  /**
   * Bump `review_analysis_epoch` and move `analysis_start_sequence` to the
   * current head, recording the transition in the consent-evidence ledger under
   * its own `analysis_backfill` kind. Refuses (throws) unless the merchant is
   * already enabled for `review_analysis` on the property's current source
   * epoch — it can never grant a capability.
   */
  repositionWatermark: (
    input: Readonly<{
      operatorId: string
      reasonCode: string
      idempotencyKey: string
      requestHash: string
      occurredAt: Date
    }>,
  ) => Promise<ReviewAnalysisWatermarkReposition>
  /** `lock_review_ai_analysis_head_v1` — the single sequence authority. */
  allocateAnalysisSequence: () => Promise<number>
  /**
   * Point the review at its fresh analysis sequence and emit the backfill
   * event, atomically. The review's `analysis_sequence` MUST move with the
   * event: `readForAi` fences the analysis on
   * `reviews.analysis_sequence = event.analysisSequence` and denies
   * `analysis_sequence_changed` otherwise, which terminal-settles the review
   * with no analysis at all. No other review column is touched — no
   * `last_fetched_at`, `content_expires_at`, `source_revision` or `updated_at`.
   */
  emitBackfillEvent: (
    input: Readonly<{
      reviewId: ReviewId
      sourceEpoch: number
      sourceRevision: number
      analysisSequence: number
      correlationId: string
      occurredAt: Date
    }>,
  ) => Promise<void>
}>
