import type { OrganizationId, PropertyId, ReviewId } from '#/shared/domain/ids'
import type { AiError } from '../../domain/errors'
import type {
  AiOperationBinding,
  AiOperationId,
  AiOperationIdentity,
} from '../../domain/types'

export type AiOperationState =
  | 'pending'
  | 'executing'
  | 'succeeded_pending_delivery'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export type AiOperationRecord = Readonly<{
  id: AiOperationId
  identity: AiOperationIdentity
  binding: AiOperationBinding
  idempotencyKey: string
  requestFingerprint: string
  sourceProvenance: Readonly<{ digest: string; byteCount: number }> | null
  state: AiOperationState
  executionAttempt: number
  executionPermitId: string | null
  nextAttemptAtEpochMillis: number | null
  failureCode: AiError['code'] | null
  createdAtEpochMillis: number
  updatedAtEpochMillis: number
  expiresAtEpochMillis: number
}>

export type AiOperationClaim =
  | Readonly<{ status: 'created'; operation: AiOperationRecord }>
  | Readonly<{ status: 'replayed'; operation: AiOperationRecord }>
  | Readonly<{ status: 'conflict' }>

type AiReviewAnalysisRecovery = Readonly<{
  eventEnvelopeId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReviewId
  sourceEpoch: number
  sourceRevision: number
  analysisSequence: number
  reviewAnalysisEpoch: number
  propertyProfileVersion: number
}>

type AiOperationRecoveryIdentity = Readonly<{
  operationId: AiOperationId
  attempt: number
  createdAtEpochMillis: number
  updatedAtEpochMillis: number
}>

export type AiOperationRecoveryCandidate =
  | Readonly<
      AiOperationRecoveryIdentity & {
        organizationId: string | null
        state: 'pending' | 'executing' | 'failed'
        failureCode: AiError['code'] | null
        analysis: AiReviewAnalysisRecovery | null
      }
    >
  | Readonly<
      AiOperationRecoveryIdentity & {
        organizationId: OrganizationId
        state: 'succeeded_pending_delivery'
        failureCode: null
        analysis: AiReviewAnalysisRecovery &
          Readonly<{
            resultStatus: 'ready' | 'unavailable' | 'missing'
          }>
      }
    >

export type AiOperationFailureInput = Readonly<{
  operationId: AiOperationId
  organizationId: string | null
  expectedAttempt: number
  failureCode: AiError['code']
  retryAtEpochMillis: number | null
  failedAtEpochMillis: number
}> &
  (
    | Readonly<{
        /** Existing provider-attempt path; `claimExecution` cleared the code. */
        expectedState?: 'executing'
        expectedFailureCode?: null
      }>
    | Readonly<{
        /** Recovery path for a retry whose dispatch owner disappeared. */
        expectedState: 'pending'
        expectedFailureCode: AiError['code'] | null
      }>
    | Readonly<{
        /** Recovery path for a completed analysis whose result cannot be delivered. */
        expectedState: 'succeeded_pending_delivery'
        expectedFailureCode?: null
      }>
  )

export type AiOperationStorePort = Readonly<{
  claim(
    input: Readonly<{
      identity: AiOperationIdentity
      binding: AiOperationBinding
      idempotencyKey: string
      requestFingerprint: string
      sourceProvenance: Readonly<{ digest: string; byteCount: number }> | null
      nowEpochMillis: number
      expiresAtEpochMillis: number
    }>,
  ): Promise<AiOperationClaim>

  claimExecution(
    input: Readonly<{
      operationId: AiOperationId
      organizationId: OrganizationId | null
      expectedAttempt: number
      nowEpochMillis: number
    }>,
  ): Promise<AiOperationRecord | null>

  recordFailure(input: AiOperationFailureInput): Promise<boolean>

  /**
   * Recoverable work, ordered deterministically, at most `limit` rows.
   *
   * Executing operations are candidates once their open attempt has outlived
   * `executionHorizonMillis`, or once the operation expires. Review Analysis
   * operations still `pending` after their operation horizon are candidates
   * too: their finite outbox dispatch may already be gone, so no request owner
   * remains to claim the scheduled retry.
   *
   * A completed Review Analysis whose result is still pending delivery after
   * the same horizon is a candidate until it reaches a terminal operation
   * state. Its result status distinguishes recoverable persisted output from a
   * corrupt/missing output that must advance the sequence without a result.
   *
   * A reaper-failed Review Analysis operation remains a candidate until its
   * originating event has a consumer receipt. That makes the operation row the
   * durable recovery fact if the process dies after fencing the provider call
   * but before advancing the strict aggregate sequence and writing the receipt.
   *
   * Candidate selection is lock-free and may be stale. Terminal writes perform
   * exact state and attempt CAS checks; failure recovery also checks the prior
   * failure code.
   */
  listExpiredExecutions(
    input: Readonly<{
      nowEpochMillis: number
      executionHorizonMillis: number
      limit: number
    }>,
  ): Promise<ReadonlyArray<AiOperationRecoveryCandidate>>

  markDelivered(
    input: Readonly<{
      operationId: AiOperationId
      organizationId: OrganizationId | null
      expectedAttempt: number
      deliveredAtEpochMillis: number
    }>,
  ): Promise<boolean>
}>
