/**
 * Content-free claim for one retired local AI derivative generation.
 * Tenant and source identifiers stay inside the repository transaction; the
 * worker only needs the lifecycle id, lease fence, attempt, and deadline.
 */
export type AiAuthorizationErasureClaim = Readonly<{
  lifecycleId: string
  leaseOwner: string
  attempt: number
  deadlineEpochMillis: number
}>

export type AiAuthorizationErasureDeletedCounts = Readonly<{
  reviewAnalysis: number
  propertyAggregate: number
  propertyTrend: number
}>

export type AiAuthorizationErasureBacklog = Readonly<{
  pending: number
  inProgress: number
  terminalFailed: number
  overdue: number
}>

export type AiAuthorizationErasureStorePort = Readonly<{
  /**
   * Claim one immediately eligible obligation. The store also terminalizes an
   * expired lease whose durable attempt budget is already exhausted.
   */
  claimNext(
    input: Readonly<{
      leaseOwner: string
      now: Date
    }>,
  ): Promise<AiAuthorizationErasureClaim | null>

  /**
   * Re-read current Identity authority, erase only the exact retired fence,
   * and persist completion/count evidence in one PostgreSQL transaction.
   */
  eraseClaim(
    input: Readonly<{
      claim: AiAuthorizationErasureClaim
      now: Date
    }>,
  ): Promise<
    | Readonly<{
        status: 'completed'
        deleted: AiAuthorizationErasureDeletedCounts
      }>
    | Readonly<{ status: 'terminal_failed' | 'lost_claim' }>
  >

  /** Failure recording is a separate CAS so a rolled-back delete can recover. */
  recordClaimFailure(
    input: Readonly<{
      claim: AiAuthorizationErasureClaim
      failureCode: 'local_delete_failed'
      occurredAt: Date
      nextAttemptAt: Date | null
    }>,
  ): Promise<Readonly<{ status: 'retry_scheduled' | 'terminal_failed' | 'lost_claim' }>>

  /** Counts only; no tenant, Property, source, or provider identifiers. */
  readBacklog(now: Date): Promise<AiAuthorizationErasureBacklog>
}>
