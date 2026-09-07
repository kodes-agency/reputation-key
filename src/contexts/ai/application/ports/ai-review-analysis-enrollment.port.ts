import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

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
