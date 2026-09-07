export type ReviewLifecycleRecoveryExecutionState =
  'applying' | 'lifecycle_applied' | 'completed'

export type ReviewLifecycleRecoveryExecutionIdentity = Readonly<{
  recoveryRunId: string
  recoveryGeneration: number
  approvalId: string
  approvalBundleSha256: string
}>

export type ReviewLifecycleRecoveryExecutionProgress = Readonly<{
  state: Exclude<ReviewLifecycleRecoveryExecutionState, 'completed'>
  reportExpired: number
  checkpoint: Readonly<{ createdAt: Date; reviewId: string }> | null
  pages: number
  scanned: number
  rowsRedacted: number
  legacyGoogleRepliesReconciled: number
}>

export type ReviewLifecycleRecoveryExecutionAuthorityInput =
  ReviewLifecycleRecoveryExecutionIdentity &
    Readonly<{
      state: 'applying'
      approverIdentity: string
      approvalKeyId: string
      approvedAt: Date
      expiresAt: Date
      releaseSha: string
      releaseManifestSha256: string
      restorePointAt: Date
      restoreDatabaseServiceName: string
      railwayProjectId: string | null
      railwayEnvironmentId: string | null
      evaluatedAt: Date
      sourcePolicyVersion: number
      retentionPolicyVersion: number
      policySha256: string
      reportSha256: string
      operatorId: string
      correlationId: string
    }>

export type BeginReviewLifecycleRecoveryExecutionInput =
  ReviewLifecycleRecoveryExecutionAuthorityInput & Readonly<{ reportExpired: number }>

export interface ReviewLifecycleRecoveryExecutionStore {
  /** Return only an exact resumable signed receipt; never creates authority. */
  resume(
    input: ReviewLifecycleRecoveryExecutionAuthorityInput,
  ): Promise<ReviewLifecycleRecoveryExecutionProgress | null>
  /** Reserve or resume the exact signed tuple; completed approvals are refused. */
  begin(
    input: BeginReviewLifecycleRecoveryExecutionInput,
  ): Promise<ReviewLifecycleRecoveryExecutionProgress & Readonly<{ resumed: boolean }>>
  complete(
    input: ReviewLifecycleRecoveryExecutionIdentity &
      Readonly<{
        recoveryCompletedAt: Date
        recoveryReplayed: boolean
      }>,
  ): Promise<void>
  fail(
    input: ReviewLifecycleRecoveryExecutionIdentity & Readonly<{ errorCode: string }>,
  ): Promise<void>
}
