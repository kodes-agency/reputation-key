import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import { AI_ADMISSION_IN_FLIGHT, type AiAdmissionLane } from '../domain/admission-lanes'

export const AI_REVIEW_ANALYSIS_ENROLLMENT_SAFETY_CEILING = 10_000
export const EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

export type ReviewAnalysisEnrollmentFence = Readonly<{
  authorizationLineageId: string
  authorizationStateVersion: number
  sourceEpoch: number
  reviewAnalysisEpoch: number
  analysisStartSequence: number
}>

export type AiAuthorizationLifecycleFence = ReviewAnalysisEnrollmentFence &
  Readonly<{
    replyDraftingEpoch: number
    propertyTrendsEpoch: number
  }>

export type AiAuthorizationLifecycleTrigger = Readonly<{
  eventEnvelopeId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  authorizationState: 'disabled' | 'enabled' | 'revoked'
  fence: AiAuthorizationLifecycleFence
  correlationId: string | null
  occurredAt: Date
}>

export type ReviewAnalysisEnrollmentTriggerResult =
  | Readonly<{ status: 'preserved'; enrollmentId: string }>
  | Readonly<{ status: 'queued'; enrollmentId: string }>
  | Readonly<{
      status: 'awaiting_assisted_approval'
      enrollmentId: string
      eligibleRevisionCount: number
      safetyCeiling: number
    }>
  | Readonly<{ status: 'duplicate'; enrollmentId: string | null }>
  | Readonly<{
      status: 'not_applicable'
      reason: 'authorization_not_enabled' | 'review_analysis_not_authorized'
    }>

export type AiAuthorizationLifecycleApplyResult =
  | Readonly<{
      status: 'applied'
      enrollment: ReviewAnalysisEnrollmentTriggerResult
    }>
  | Readonly<{
      status: 'duplicate'
      enrollmentId: string | null
    }>
  | Readonly<{
      status: 'obsolete'
      reason:
        | 'authorization_absent'
        | 'authorization_lineage_changed'
        | 'authorization_state_changed'
        | 'authorization_state_version_changed'
        | 'source_epoch_changed'
        | 'review_analysis_epoch_changed'
        | 'reply_drafting_epoch_changed'
        | 'property_trends_epoch_changed'
        | 'analysis_start_sequence_changed'
        | 'property_inactive'
    }>

export type ReviewAnalysisEnrollmentState =
  | 'awaiting_assisted_approval'
  | 'queued'
  | 'running'
  | 'caught_up'
  | 'superseded'
  | 'stalled'

export type ReviewAnalysisEnrollmentAssistedApproval = Readonly<{
  approvedAtEpochMillis: number
  approvedByOperatorId: string
  approvalEvidenceDigest: string
  correlationId: string
}>

export type ReviewAnalysisEnrollmentHead = Readonly<{
  id: string
  organizationId: OrganizationId
  propertyId: PropertyId
  fence: ReviewAnalysisEnrollmentFence
  providerDeploymentProfileVersion: string
  state: 'queued' | 'running'
}>

export type ReviewAnalysisEnrollmentReconcileResult =
  | Readonly<{
      status: 'awaiting_assisted_approval'
      eligibleRevisionCount: number
      safetyCeiling: number
    }>
  | Readonly<{ status: 'waiting_for_replay' }>
  | Readonly<{
      status: 'replay_started'
      runId: string
      pinnedRevisionCount: number
    }>
  | Readonly<{
      status: 'caught_up'
      eligibleRevisionCount: number
      caughtUpAnalysisSequence: number
      revisionSetDigest: string
    }>
  | Readonly<{
      status: 'superseded'
      reason:
        | 'authorization_changed'
        | 'source_epoch_changed'
        | 'property_inactive'
        | 'replay_superseded'
    }>
  | Readonly<{
      status: 'stalled'
      reason: 'replay_stalled' | 'verification_inconsistent'
    }>

export type ReviewAnalysisEnrollmentEvidence = Readonly<{
  id: string
  organizationId: OrganizationId
  propertyId: PropertyId
  fence: ReviewAnalysisEnrollmentFence
  state: ReviewAnalysisEnrollmentState
  triggerEventEnvelopeId: string
  snapshotRevisionCount: number
  snapshotRevisionSetDigest: string
  snapshotCapturedAtEpochMillis: number
  safetyCeiling: number
  assistedApprovalRequired: boolean
  assistedApproval: ReviewAnalysisEnrollmentAssistedApproval | null
  enrolledRevisionCount: number
  caughtUpEligibleRevisionCount: number | null
  caughtUpAnalysisSequence: number | null
  caughtUpRevisionSetDigest: string | null
  caughtUpAtEpochMillis: number | null
  terminalReason: string | null
}>

export type ReviewAnalysisEnrollmentAssistedApprovalResult =
  | Readonly<{ status: 'approved'; enrollmentId: string }>
  | Readonly<{ status: 'duplicate'; enrollmentId: string }>
  | Readonly<{
      status: 'refused'
      reason:
        | 'enrollment_not_found'
        | 'approval_not_required'
        | 'approval_conflict'
        | 'approval_time_invalid'
        | 'authorization_changed'
        | 'property_inactive'
        | 'enrollment_terminal'
    }>

export function isReviewAnalysisRevisionSetEvidence(
  input: Readonly<{ revisionCount: number; revisionSetDigest: string }>,
): boolean {
  return (
    Number.isSafeInteger(input.revisionCount) &&
    input.revisionCount >= 0 &&
    /^[0-9a-f]{64}$/.test(input.revisionSetDigest) &&
    (input.revisionCount === 0
      ? input.revisionSetDigest === EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST
      : input.revisionSetDigest !== EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST)
  )
}

export type ReviewAnalysisEnrollmentStorePort = Readonly<{
  applyAuthorizationLifecycle(
    input: AiAuthorizationLifecycleTrigger,
  ): Promise<AiAuthorizationLifecycleApplyResult>
  listActionable(limit: number): Promise<ReadonlyArray<ReviewAnalysisEnrollmentHead>>
  reconcile(
    input: Readonly<{
      enrollmentId: string
      organizationId: OrganizationId
      expectedFence: ReviewAnalysisEnrollmentFence
      correlationId: string
      occurredAt: Date
    }>,
  ): Promise<ReviewAnalysisEnrollmentReconcileResult>
  approveAssistedReplay(
    input: Readonly<{
      enrollmentId: string
      organizationId: OrganizationId
      expectedFence: ReviewAnalysisEnrollmentFence
      approvedByOperatorId: string
      approvalEvidenceDigest: string
      correlationId: string
      occurredAt: Date
    }>,
  ): Promise<ReviewAnalysisEnrollmentAssistedApprovalResult>
  markSuperseded(
    input: Readonly<{
      enrollmentId: string
      organizationId: OrganizationId
      expectedFence: ReviewAnalysisEnrollmentFence
      reason: 'authorization_changed' | 'source_epoch_changed' | 'property_inactive'
      occurredAt: Date
    }>,
  ): Promise<boolean>
  readCurrent(
    input: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  ): Promise<ReviewAnalysisEnrollmentEvidence | null>
}>
/** Why an analysis event waits in the backlog instead of running on delivery. */
export type AiReviewAnalysisBacklogOrigin =
  | 'historical_onboarding'
  | 'backfill'
  /**
   * A live event that could not run when it was delivered: its background lane
   * was busy, current policy refused its Organization or Property, or an AI
   * execution control was stopped.
   */
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
  /**
   * Return a claimed entry to the queue until `nextAttemptAtEpochMillis`
   * without its work having been tried: current policy refused it, or an AI
   * execution control was stopped. Unlike `reschedule` it counts no attempt,
   * and it clears the entry's first start, so the operation horizon begins
   * when a drainer next takes it: time spent held by a stop is not a stuck
   * attempt.
   */
  release(
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
export type AiReviewAnalysisReopenResult = Readonly<{
  /** Reviews given a fresh analysis sequence and a backfill event. */
  reopened: number
  /**
   * Reviews that would qualify but have used every reopen: they stay settled
   * as not analysable. Reported on every sweep so they are never silent.
   */
  leftUnanalysed: number
}>

export type AiReviewAnalysisReopenPort = Readonly<{
  /**
   * Reopen text reviews whose current analysis settled without a result
   * because its operation gave up for a reason that says nothing about the
   * review (ADR 0058). Each gets a fresh analysis sequence and an
   * `ai.review_analysis.backfill_requested` event, in one transaction per
   * Property, so it is queued again through the ordinary path. At most
   * `limit` reviews per call.
   */
  reopenAbandoned(
    input: Readonly<{ limit: number; occurredAt: Date }>,
  ): Promise<AiReviewAnalysisReopenResult>
}>

/** How long a drainer owns a claimed entry before another may take it. */
export const AI_BACKLOG_CLAIM_LEASE_MILLIS = 3 * 60_000
/**
 * Provider calls one drain runs at once. It equals an organization's
 * background in-flight budget, so one organization's import can use the whole
 * drain. It stays below the worker's database pool: an analysis holds a client
 * only for one short transaction at a time, never across its provider call.
 */
export const AI_BACKLOG_DRAIN_CONCURRENCY = AI_ADMISSION_IN_FLIGHT.organization.background
/**
 * A drain keeps claiming rounds for this long, then leaves the rest to the
 * next tick. It stays under the worker's 25-second shutdown budget, so a
 * deploy rarely interrupts a round.
 */
export const AI_BACKLOG_DRAIN_TIME_BUDGET_MILLIS = 20_000
