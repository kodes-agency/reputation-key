import type {
  AiAuthorizationErasureBacklog,
  AiAuthorizationErasureDeletedCounts,
  AiAuthorizationErasureStorePort,
} from '../ports/ai-authorization-erasure.port'

export const AI_AUTHORIZATION_ERASURE_MAX_ATTEMPTS = 8
export const AI_AUTHORIZATION_ERASURE_LEASE_MILLIS = 2 * 60 * 1_000
export const AI_AUTHORIZATION_ERASURE_DEFAULT_BATCH_SIZE = 25
const AI_AUTHORIZATION_ERASURE_RETRY_BASE_MILLIS = 30_000
const AI_AUTHORIZATION_ERASURE_MAX_BATCH_SIZE = 100

export type EraseAiAuthorizationDerivativesResult = Readonly<{
  claimed: number
  completed: number
  retryScheduled: number
  terminalFailed: number
  lostClaims: number
  deleted: AiAuthorizationErasureDeletedCounts & Readonly<{ total: number }>
  batchFull: boolean
  backlog: AiAuthorizationErasureBacklog
}>

export type EraseAiAuthorizationDerivativesDependencies = Readonly<{
  store: AiAuthorizationErasureStorePort
  clock: () => Date
  leaseOwner: string
  batchSize?: number
}>

const retryDelayMillis = (attempt: number): number =>
  AI_AUTHORIZATION_ERASURE_RETRY_BASE_MILLIS * 2 ** Math.max(0, attempt - 1)

const emptyDeletedCounts = (): AiAuthorizationErasureDeletedCounts => ({
  reviewAnalysis: 0,
  propertyAggregate: 0,
  propertyTrend: 0,
})

const addDeletedCounts = (
  target: { reviewAnalysis: number; propertyAggregate: number; propertyTrend: number },
  added: AiAuthorizationErasureDeletedCounts,
): void => {
  target.reviewAnalysis += added.reviewAnalysis
  target.propertyAggregate += added.propertyAggregate
  target.propertyTrend += added.propertyTrend
}

/**
 * Drain one bounded batch of retired local AI derivative generations.
 *
 * The application process never receives tenant/source/content fields. A
 * thrown database error is reduced to one stable code before the separately
 * committed recovery CAS; raw errors are neither logged nor persisted here.
 */
export const createEraseAiAuthorizationDerivatives = (
  dependencies: EraseAiAuthorizationDerivativesDependencies,
): (() => Promise<EraseAiAuthorizationDerivativesResult>) => {
  const batchSize = dependencies.batchSize ?? AI_AUTHORIZATION_ERASURE_DEFAULT_BATCH_SIZE
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > AI_AUTHORIZATION_ERASURE_MAX_BATCH_SIZE
  ) {
    throw new Error('AI authorization erasure batch size is invalid')
  }

  return async () => {
    const deleted = emptyDeletedCounts()
    let claimed = 0
    let completed = 0
    let retryScheduled = 0
    let terminalFailed = 0
    let lostClaims = 0

    for (; claimed < batchSize;) {
      const claimedAt = dependencies.clock()
      const claim = await dependencies.store.claimNext({
        leaseOwner: dependencies.leaseOwner,
        now: claimedAt,
      })
      if (!claim) break
      claimed += 1

      try {
        const result = await dependencies.store.eraseClaim({
          claim,
          now: dependencies.clock(),
        })
        if (result.status === 'completed') {
          completed += 1
          addDeletedCounts(deleted, result.deleted)
        } else if (result.status === 'terminal_failed') {
          terminalFailed += 1
        } else {
          lostClaims += 1
        }
      } catch {
        const occurredAt = dependencies.clock()
        const terminal = claim.attempt >= AI_AUTHORIZATION_ERASURE_MAX_ATTEMPTS
        const recovery = await dependencies.store.recordClaimFailure({
          claim,
          failureCode: 'local_delete_failed',
          occurredAt,
          nextAttemptAt: terminal
            ? null
            : new Date(occurredAt.getTime() + retryDelayMillis(claim.attempt)),
        })
        if (recovery.status === 'retry_scheduled') retryScheduled += 1
        else if (recovery.status === 'terminal_failed') terminalFailed += 1
        else lostClaims += 1
      }
    }

    const backlog = await dependencies.store.readBacklog(dependencies.clock())
    return {
      claimed,
      completed,
      retryScheduled,
      terminalFailed,
      lostClaims,
      deleted: {
        ...deleted,
        total: deleted.reviewAnalysis + deleted.propertyAggregate + deleted.propertyTrend,
      },
      batchFull: claimed === batchSize,
      backlog,
    }
  }
}
