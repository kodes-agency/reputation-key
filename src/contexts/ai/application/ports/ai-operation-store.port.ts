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

  markDelivered(
    input: Readonly<{
      operationId: AiOperationId
      expectedAttempt: number
      deliveredAtEpochMillis: number
    }>,
  ): Promise<boolean>
}>
