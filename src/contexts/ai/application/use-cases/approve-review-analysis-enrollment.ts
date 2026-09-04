import type { OrganizationId } from '#/shared/domain/ids'
import type { ReviewAnalysisEnrollmentStorePort } from '../ports/ai-review-analysis-enrollment.port'
import type { ReviewAnalysisEnrollmentFence } from '../ports/ai-review-analysis-enrollment.port'

export type ApproveReviewAnalysisEnrollmentInput = Readonly<{
  enrollmentId: string
  organizationId: OrganizationId
  expectedFence: ReviewAnalysisEnrollmentFence
  approvedByOperatorId: string
  approvalEvidenceDigest: string
  correlationId: string
  occurredAt: Date
}>

export type ApproveReviewAnalysisEnrollmentResult =
  | Awaited<ReturnType<ReviewAnalysisEnrollmentStorePort['approveAssistedReplay']>>
  | Readonly<{ status: 'refused'; reason: 'approval_evidence_invalid' }>

export type ApproveReviewAnalysisEnrollmentDependencies = Readonly<{
  enrollments: ReviewAnalysisEnrollmentStorePort
}>

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const POSTGRES_INTEGER_MAX = 2_147_483_647

const isBoundedInteger = (value: number, minimum: number): boolean =>
  Number.isSafeInteger(value) && value >= minimum && value <= POSTGRES_INTEGER_MAX

function evidenceIsValid(input: ApproveReviewAnalysisEnrollmentInput): boolean {
  return (
    UUID_RE.test(input.enrollmentId) &&
    UUID_RE.test(input.organizationId) &&
    UUID_RE.test(input.expectedFence.authorizationLineageId) &&
    isBoundedInteger(input.expectedFence.authorizationStateVersion, 1) &&
    isBoundedInteger(input.expectedFence.sourceEpoch, 0) &&
    isBoundedInteger(input.expectedFence.reviewAnalysisEpoch, 1) &&
    Number.isSafeInteger(input.expectedFence.analysisStartSequence) &&
    input.expectedFence.analysisStartSequence >= 0 &&
    UUID_RE.test(input.correlationId) &&
    input.approvedByOperatorId.trim() === input.approvedByOperatorId &&
    input.approvedByOperatorId.length > 0 &&
    input.approvedByOperatorId.length <= 255 &&
    /^[0-9a-f]{64}$/u.test(input.approvalEvidenceDigest) &&
    Number.isSafeInteger(input.occurredAt.getTime()) &&
    input.occurredAt.getTime() >= 0
  )
}

/**
 * Deliberately narrow approval seam for a complete over-ceiling snapshot. It
 * cannot create enrollment, change merchant authorization, or select a subset;
 * the exact persisted fence remains the store's transactional authority.
 */
export const createApproveReviewAnalysisEnrollment = (
  dependencies: ApproveReviewAnalysisEnrollmentDependencies,
): ((
  input: ApproveReviewAnalysisEnrollmentInput,
) => Promise<ApproveReviewAnalysisEnrollmentResult>) => {
  return async (input) => {
    if (!evidenceIsValid(input)) {
      return { status: 'refused', reason: 'approval_evidence_invalid' }
    }
    return dependencies.enrollments.approveAssistedReplay(input)
  }
}
