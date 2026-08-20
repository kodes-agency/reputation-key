import type { AiError } from '../../domain/errors'
import type {
  AiOperationBinding,
  AiOperationCommand,
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

  read(
    input: Readonly<{
      operationId: AiOperationId
      command: AiOperationCommand
    }>,
  ): Promise<AiOperationRecord | null>

  claimExecution(
    input: Readonly<{
      operationId: AiOperationId
      expectedAttempt: number
      nowEpochMillis: number
    }>,
  ): Promise<AiOperationRecord | null>

  recordFailure(
    input: Readonly<{
      operationId: AiOperationId
      expectedAttempt: number
      failureCode: AiError['code']
      retryAtEpochMillis: number | null
      failedAtEpochMillis: number
    }>,
  ): Promise<boolean>

  /**
   * Operations still `executing` past their own horizon, oldest first, at most
   * `limit` rows.
   *
   * Candidate selection only: nothing here decides the outcome. An attempt that
   * dies between `claimExecution` and its terminal write — a crashed process, a
   * killed request, a rejected settlement write — leaves the row `executing`
   * with nobody left to finish it, and `claim` already refuses expired rows, so
   * it can never be picked up again either. Without this the row stays
   * `executing` forever and every count of in-flight AI work is permanently
   * wrong.
   */
  listExpiredExecutions(
    input: Readonly<{ nowEpochMillis: number; limit: number }>,
  ): Promise<ReadonlyArray<Readonly<{ operationId: AiOperationId; attempt: number }>>>

  markDelivered(
    input: Readonly<{
      operationId: AiOperationId
      expectedAttempt: number
      deliveredAtEpochMillis: number
    }>,
  ): Promise<boolean>
}>
