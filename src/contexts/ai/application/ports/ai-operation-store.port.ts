import type { OrganizationId } from '#/shared/domain/ids'
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

  recordFailure(
    input: Readonly<{
      operationId: AiOperationId
      organizationId: string | null
      expectedAttempt: number
      failureCode: AiError['code']
      retryAtEpochMillis: number | null
      failedAtEpochMillis: number
    }>,
  ): Promise<boolean>

  /**
   * Abandoned executions, oldest first, at most `limit` rows.
   *
   * An abandoned execution is one whose OPEN ATTEMPT has outlived
   * `executionHorizonMillis` — not one whose operation has outlived its own
   * `expires_at`. The distinction is the whole point. `expires_at` is the
   * operation's idempotency lifetime (24h for review analysis), while the
   * attempt is bounded by the domain's 15-minute operation horizon, so keying
   * recovery on `expires_at` hid every abandoned execution for a day. That is
   * exactly what the closed beta saw: four operations sat `executing` with
   * settled `success` permits while the reaper reported `abandonedVisited=0`
   * on every run, because their `expires_at` was 24 hours away.
   *
   * `expires_at` still selects on its own, for the operations whose horizon
   * cannot be read from an attempt row at all.
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
    input: Readonly<{
      nowEpochMillis: number
      /** How long an open attempt may run before it is abandoned. */
      executionHorizonMillis: number
      limit: number
    }>,
  ): Promise<
    ReadonlyArray<
      Readonly<{
        operationId: AiOperationId
        attempt: number
        organizationId: string | null
      }>
    >
  >

  markDelivered(
    input: Readonly<{
      operationId: AiOperationId
      organizationId: OrganizationId | null
      expectedAttempt: number
      deliveredAtEpochMillis: number
    }>,
  ): Promise<boolean>
}>
