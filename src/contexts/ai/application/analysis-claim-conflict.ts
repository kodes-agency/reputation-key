// AI context — what a review analysis does when its event's idempotency key
// already holds another request (`operations.claim` answers `conflict`).

import type { OrganizationId } from '#/shared/domain/ids'
import type { AiExecutionBinding } from '../domain/types'
import { isSameAiRequestUnderOtherControls } from './ai-workflow-support'
import type {
  AiOperationRecord,
  AiOperationStorePort,
} from './ports/ai-operation-store.port'
import type { AiReviewAnalysisTerminalDisposition } from './ports/ai-review-event-store.port'

/** How the review is settled, and against which operation, after a conflict. */
type AnalysisClaimConflictResolution = Readonly<{
  operationId: string | null
  dispositionCode: Extract<
    AiReviewAnalysisTerminalDisposition,
    'operation_abandoned' | 'policy_disabled'
  >
}>

/** A request that is not this analysis's own: nothing of its is closed. */
const NOT_ITS_OWN: AnalysisClaimConflictResolution = Object.freeze({
  operationId: null,
  dispositionCode: 'policy_disabled',
})

/**
 * Decide a conflicting claim. When the recorded request is this one under AI
 * execution controls that have since moved, it is the review's own operation,
 * claimed before an operator stopped and restored a control: a full lane or a
 * provider "later" is enough to claim one. Its key can never be claimed again
 * and nothing would run it, so a pending one is closed as
 * `execution_suspended`, a code the reopen pass reads as "nobody judged the
 * review" (ADR 0058). The review then gets a fresh sequence and a fresh
 * operation at the next sweep; left pending, the operation would wait for the
 * reaper to abandon it at its 24-hour expiry. A lost compare-and-set means the
 * reaper closed it first, with a reopen code of its own.
 *
 * Anything else under the key is not this analysis's to close: the review is
 * settled as not analysable and the operation is left to its owner. That
 * includes its own operation in another state: an executing one is the
 * reaper's to fence, and a finished one has its outcome.
 */
export async function resolveAnalysisClaimConflict<
  Request extends Readonly<{ binding: AiExecutionBinding }>,
>(
  operations: Pick<AiOperationStorePort, 'recordFailure'>,
  conflict: Readonly<{
    existing: AiOperationRecord
    /** What this claim fingerprinted. */
    request: Request
    organizationId: OrganizationId
    nowEpochMillis: number
  }>,
): Promise<AnalysisClaimConflictResolution> {
  const { existing } = conflict
  if (
    existing.state !== 'pending' ||
    !isSameAiRequestUnderOtherControls(existing, conflict.request)
  ) {
    return NOT_ITS_OWN
  }
  await operations.recordFailure({
    operationId: existing.id,
    organizationId: conflict.organizationId,
    expectedAttempt: existing.executionAttempt,
    expectedState: 'pending',
    expectedFailureCode: existing.failureCode,
    failureCode: 'execution_suspended',
    retryAtEpochMillis: null,
    failedAtEpochMillis: conflict.nowEpochMillis,
  })
  return { operationId: existing.id, dispositionCode: 'operation_abandoned' }
}
