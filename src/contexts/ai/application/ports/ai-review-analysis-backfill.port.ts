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
  /**
   * Every property with a run still owed work, oldest first. Lock-free and
   * allowed to be stale: each property is re-read under its own exclusive
   * session before anything is written.
   */
  listRunningRuns: (
    limit: number,
  ) => Promise<
    ReadonlyArray<
      Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>
    >
  >
}>

/**
 * Identity-owned lookup: users holding active access to one property.
 *
 * Identity owns the grant table (ADR 0039 — explicit grants are the sole
 * authorization source for property scope), so this context never reads it.
 * Structurally identical to identity's own `PropertyGrantHolderLookup`, declared
 * here so the AI context depends on a shape rather than on identity's adapter,
 * exactly as the notification context does.
 */
export type PropertyAccessHolderLookup = (
  organizationId: string,
  propertyId: string,
) => Promise<ReadonlyArray<string>>

/**
 * The member whose consent this backfill replays — the `actor_user_id` of the
 * most recent MERCHANT CONSENT DECISION in the lineage ('enable', 'change',
 * 'revoke' or 'restore_reset') at or below the enablement's current
 * `state_version`, which the backfill carries forward onto its own row.
 *
 * Never an `analysis_backfill` row. That kind records that a replay HAPPENED,
 * not that consent was given, so inheriting from one lets a single bad run
 * poison every later run of an append-only lineage: the closed-beta property
 * had an operator identity sitting at its head, unfixable by construction, and
 * every subsequent backfill refused. Carrying the last real decision forward
 * instead makes the lineage self-heal from the next run.
 *
 * That column is resolved as a `member."userId"`: `admit_ai_property_v1` falls
 * back to it for any operation with a NULL `actor_user_id` (every system-run
 * analysis) and denies `authorization_changed` unless it resolves to a member
 * with authority over the property. So it must name a real accountable member,
 * never the operator who triggered the replay.
 */
export type ReviewAnalysisConsentActor = Readonly<{
  /** `merchant_ai_consent_evidence.actor_user_id`, i.e. a `member."userId"`. */
  userId: string
  /**
   * The `state_version` of the consent decision this actor came from — NOT the
   * enablement head's, which may be an `analysis_backfill` row. Named in the
   * refusal so an operator can read the decision being replayed.
   */
  stateVersion: number
  /**
   * That actor's `member.role` for this organization, verbatim (it is a
   * comma-separated token list), or null when they are not a member at all.
   *
   * The authority VERDICT is not decided here: owner is settled by the role
   * alone, but an admin also needs an active property grant, and the grant
   * table belongs to identity. The use case combines this with
   * `PropertyAccessHolderLookup`.
   */
  memberRole: string | null
}>

/** The live merchant enablement head, or null when AI was never enabled here. */
export type ReviewAnalysisBackfillEnablement = Readonly<{
  state: string
  capabilities: ReadonlyArray<string>
  authorizedSourceEpoch: number
  reviewAnalysisEpoch: number
  analysisStartSequence: number
  stateVersion: number
  /** Named in the refusal, so an operator can find the lineage without SQL. */
  authorizationLineageId: string
  /** Null when the lineage holds no merchant consent decision at all. */
  consentActor: ReviewAnalysisConsentActor | null
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
  /**
   * The actor the ledger row actually recorded — derived by the SQL from the
   * consent it replays, never supplied by the caller. Returned so the use case
   * can assert the write matched the actor it validated.
   */
  consentActorUserId: string
}>

export type ReviewAnalysisBackfillRunState =
  | 'running'
  | 'completed'
  | 'superseded'
  | 'stalled'

/**
 * A durable `ops:ai-reanalyze` run. It exists because a backfill may only ever
 * have ONE review in flight: `storeAnalysis` refuses unless
 * `review_ai_analysis_heads.head_sequence` still equals the sequence being
 * stored, so a batch that allocates `H+1 … H+N` up front makes every sequence
 * but the last permanently unstorable. Each item is therefore allocated only
 * once its predecessor has settled, and the run row is what carries the batch
 * across those steps — inside the single epoch it opened.
 */
export type ReviewAnalysisBackfillRun = Readonly<{
  id: string
  sourceEpoch: number
  reviewAnalysisEpoch: number
  /** `H` — the watermark this run repositioned to when it opened. */
  analysisStartSequence: number
  /** The pinned, ordered candidate set. Never recomputed. */
  reviewIds: ReadonlyArray<ReviewId>
  emittedReviewCount: number
  skippedReviewCount: number
  recoveredReviewCount: number
  /** The item in flight, or null before the first emission. */
  currentAnalysisSequence: number | null
  currentReviewId: ReviewId | null
  currentEmittedAtEpochMillis: number | null
  correlationId: string
}>

/** The consume-side state of one emitted item, or null when never consumed. */
export type ReviewAnalysisOutcomeState = 'pending' | 'ready' | 'terminal_no_result'

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
   *
   * Takes NO actor. The ledger's `actor_user_id` is a `member."userId"`, and a
   * backfill grants no new consent, so the SQL derives the accountable member
   * from the consent it replays and refuses if that member no longer resolves.
   * The operator behind the run is carried by `reasonCode` and the ops
   * harness's own audit trail, which is where an operator belongs.
   */
  repositionWatermark: (
    input: Readonly<{
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
  /** The run still owed work on this property, or null. */
  readActiveRun: () => Promise<ReviewAnalysisBackfillRun | null>
  /** Open the run this backfill drives. Returns its id. */
  openRun: (
    input: Readonly<{
      sourceEpoch: number
      reviewAnalysisEpoch: number
      analysisStartSequence: number
      reviewIds: ReadonlyArray<ReviewId>
      reasonCode: string
      correlationId: string
      occurredAt: Date
    }>,
  ) => Promise<string>
  /**
   * One pinned candidate re-read at the moment its turn comes, under the
   * property lock, or null when it is no longer eligible. Eligibility is
   * re-checked because a run spans minutes: content can expire and a review can
   * be repointed while the run is in flight, and emitting on a stale revision
   * would spend a sequence on an analysis that can never be stored.
   */
  readEligibleCandidate: (
    reviewId: ReviewId,
  ) => Promise<ReviewAnalysisBackfillCandidate | null>
  /** The consume-side state of one emitted item, or null when never consumed. */
  readOutcomeState: (
    input: Readonly<{ reviewAnalysisEpoch: number; analysisSequence: number }>,
  ) => Promise<ReviewAnalysisOutcomeState | null>
  /** Record the item just emitted as the run's in-flight cursor. */
  advanceRun: (
    input: Readonly<{
      runId: string
      reviewId: ReviewId
      analysisSequence: number
      occurredAt: Date
    }>,
  ) => Promise<void>
  /** Step past a pinned review that is no longer eligible. Spends no sequence. */
  skipRunCandidate: (
    input: Readonly<{ runId: string; occurredAt: Date }>,
  ) => Promise<void>
  /** Count an emitted item the sweep had to terminal-settle itself. */
  recordRunRecovery: (
    input: Readonly<{ runId: string; occurredAt: Date }>,
  ) => Promise<void>
  closeRun: (
    input: Readonly<{
      runId: string
      state: Exclude<ReviewAnalysisBackfillRunState, 'running'>
      terminalReason: string
      occurredAt: Date
    }>,
  ) => Promise<void>
}>
