import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { MerchantAiCapability } from '#/shared/domain/merchant-ai-capability'

/**
 * Local derivative erasure starts at containment and must complete within the
 * operational 24-hour objective. Read-time hiding is immediate and never waits
 * for this deadline.
 */
export const AI_LOCAL_DERIVATIVE_ERASURE_WINDOW_MILLIS = 24 * 60 * 60 * 1_000

/**
 * A first-enablement snapshot above this size remains complete and immutable,
 * but no replay is opened until a ticketed operator has reviewed the expected
 * provider work. This is a cost/operability pause, never a coverage cap.
 */
export const AI_REVIEW_ANALYSIS_ENROLLMENT_SAFETY_CEILING = 10_000

export type AiLocalDerivativeDataClass =
  'review_analysis' | 'property_aggregate' | 'property_trend'

/**
 * SHA-256 of the empty byte string. Revision-set digests use this one
 * canonical value for an empty eligible population; accepting an arbitrary
 * digest beside a zero count would make "zero-review ready" unauditable.
 */
export const EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/**
 * Exact Identity authorization generation whose eligible Review population must
 * be enrolled before Review Analysis is considered prepared.
 *
 * This is deliberately stricter than "AI is enabled". A delayed event for an
 * older state version, source epoch, capability epoch, or watermark may never
 * create work in the current generation.
 */
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

export type AiAuthorizationLifecycleEvidence = Readonly<{
  id: string
  eventEnvelopeId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  authorizationState: 'disabled' | 'enabled' | 'revoked'
  transitionKind: 'enable' | 'change' | 'revoke' | 'restore_reset' | 'analysis_backfill'
  fence: AiAuthorizationLifecycleFence
  authorizedCapabilities: ReadonlyArray<MerchantAiCapability>
  /** AI-owned local derivative classes that may be served for this exact fence. */
  visibleDataClasses: ReadonlyArray<AiLocalDerivativeDataClass>
  /** Prior-generation local derivative classes hidden by this transition. */
  retiredDataClasses: ReadonlyArray<AiLocalDerivativeDataClass>
  erasureStatus: 'not_required' | 'pending' | 'in_progress' | 'completed' | 'failed'
  erasureDeadlineEpochMillis: number | null
  appliedAtEpochMillis: number
}>

export type ReviewAnalysisEnrollmentTriggerResult =
  | Readonly<{
      status: 'queued'
      enrollmentId: string
    }>
  | Readonly<{
      status: 'awaiting_assisted_approval'
      enrollmentId: string
      eligibleRevisionCount: number
      safetyCeiling: number
    }>
  | Readonly<{
      status: 'duplicate'
      enrollmentId: string | null
    }>
  | Readonly<{
      status: 'not_applicable'
      reason: 'authorization_not_enabled' | 'review_analysis_not_authorized'
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
        | 'analysis_start_sequence_changed'
        | 'property_inactive'
    }>

export type AiAuthorizationLifecycleApplyResult =
  | Readonly<{
      status: 'applied'
      lifecycle: AiAuthorizationLifecycleEvidence
      enrollment: Exclude<
        ReviewAnalysisEnrollmentTriggerResult,
        Readonly<{ status: 'obsolete' }>
      >
    }>
  | Readonly<{
      status: 'duplicate'
      lifecycleId: string | null
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

/**
 * Content-free actionable enrollment head. The store never returns Review ids,
 * text, source digests, or the revision set itself to the sweep.
 */
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
      /** Current, exact material Review revisions pinned by this run. */
      pinnedRevisionCount: number
    }>
  | Readonly<{
      status: 'caught_up'
      /** Eligible exact material revisions at the atomic verification point. */
      eligibleRevisionCount: number
      /** Current Review analysis allocator head at that same point. */
      caughtUpAnalysisSequence: number
      /**
       * SHA-256 over the deterministic, review-id-ordered
       * `(review_id, Material Review Revision, analysis_sequence)` population.
       * No source content enters the digest. The empty population MUST use
       * `EMPTY_REVIEW_ANALYSIS_REVISION_SET_DIGEST`.
       */
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
  activeRunId: string | null
  /** Immutable eligible Material Review Revision set captured for this fence. */
  snapshotRevisionCount: number
  snapshotRevisionSetDigest: string
  snapshotCapturedAtEpochMillis: number
  safetyCeiling: number
  assistedApprovalRequired: boolean
  assistedApproval: ReviewAnalysisEnrollmentAssistedApproval | null
  /** Snapshot revisions actually transferred to one or more replay runs. */
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

/**
 * Validate a durable content-free revision-set proof without reconstructing
 * its membership in the application process. The database remains the
 * set-based digest authority; this guard only rejects structurally impossible
 * count/digest pairs at read boundaries.
 */
export function isReviewAnalysisRevisionSetEvidence(
  input: Readonly<{
    revisionCount: number
    revisionSetDigest: string
  }>,
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

/**
 * Repository-owned command/read boundary for first-enablement completeness.
 *
 * `applyAuthorizationLifecycle` MUST compare the complete delivered Identity
 * fence with the current Property + authorization rows and write the AI-owned
 * visibility/erasure evidence, enrollment outcome, supersession, and
 * `ai.enroll-review-analysis` consumer receipt in one transaction. The capped
 * operator repair command is intentionally not part of this contract.
 *
 * `reconcile` MUST be server-side and set-based: it may not load the complete
 * eligible Review population into Node. It either opens one bounded replay run
 * using relational membership, proves a zero/unresolved-free population caught
 * up, or returns a named terminal/waiting outcome.
 */
export type ReviewAnalysisEnrollmentStorePort = Readonly<{
  applyAuthorizationLifecycle(
    input: AiAuthorizationLifecycleTrigger,
  ): Promise<AiAuthorizationLifecycleApplyResult>

  readCurrentLifecycle(
    input: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  ): Promise<AiAuthorizationLifecycleEvidence | null>

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
